#!/usr/bin/env bash
# =============================================================================
# healthcheck.sh — Canonical DevContainer Health Classifier
# Version: v3.0.0
#
# Purpose:
#   Fast, conservative health classifier for this DevContainer. Designed for
#   Docker HEALTHCHECK, `make health`, and human diagnostics.
#
# Contract:
#   - Uses only Docker-compatible exit codes: 0 healthy, 1 unhealthy.
#   - Fails only for fatal runtime invariants.
#   - Treats Copilot/GitHub route/proxy/DNS/advisor degradation as advisory or
#     degraded unless explicitly promoted to fatal by configuration.
#   - Performs no structural mutation, no network route mutation, no DNS rewrite,
#     no proxy start/stop, no benchmark and no external GitHub/Copilot probe.
#   - Writes machine-readable /tmp health artifacts for post-attach and Makefile.
#
# Fatal by default:
#   - Node.js missing, unusable, below required major, or resolved from /mnt/<drive>.
#   - npm missing/unusable when required, or resolved from /mnt/<drive>.
#   - broken Linux identity/NSS invariants that make the user unresolvable.
#   - /tmp or HOME unavailable/unwritable.
#   - root filesystem critically full.
#   - explicit fatal/unhealthy status from core lifecycle artifacts.
#
# Non-fatal by default:
#   - Chrome/CDP stopped.
#   - VS Code Server absent.
#   - Copilot network degraded.
#   - local DNS cache off/degraded/stale.
#   - local Copilot proxy off/missing/degraded.
#   - route advisor missing/degraded.
#   - benchmark/comparison/recommendation artifacts missing or stale.
# =============================================================================

set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

SCRIPT_NAME="healthcheck.sh"
readonly SCRIPT_NAME
SCRIPT_VERSION="3.0.0"
readonly SCRIPT_VERSION

EXIT_HEALTHY=0
EXIT_UNHEALTHY=1
readonly EXIT_HEALTHY EXIT_UNHEALTHY

QUIET="false"
BRIEF="false"
STRICT_MODE="${DEVCONTAINER_HEALTHCHECK_STRICT:-false}"
CHECK_CDP="${DEVCONTAINER_HEALTHCHECK_CHECK_CDP:-true}"
WRITE_ARTIFACTS="${DEVCONTAINER_HEALTHCHECK_WRITE_ARTIFACTS:-true}"

case "${1:-}" in
    --version)
        printf '%s v%s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}"
        exit 0
        ;;
    --help)
        cat << 'USAGE'
healthcheck.sh [--help] [--version] [--brief] [--quiet] [--strict] [--no-cdp]

Fast conservative DevContainer health classifier.

Exit codes are Docker HEALTHCHECK-compatible:
  0  healthy enough for Docker
  1  fatal/unhealthy

Options:
  --brief     reduce human output
  --quiet     only print final line
  --strict    promote degraded checks to fatal
  --no-cdp    skip local Chrome/CDP advisory probe

Environment knobs:
  DEVCONTAINER_HEALTHCHECK_MIN_NODE_MAJOR=24
  DEVCONTAINER_HEALTHCHECK_REQUIRE_NPM=true
  DEVCONTAINER_HEALTHCHECK_STRICT=false
  DEVCONTAINER_HEALTHCHECK_NETWORK_FATAL=false
  DEVCONTAINER_HEALTHCHECK_ROOT_USAGE_FATAL_PERCENT=98
  DEVCONTAINER_HEALTHCHECK_MIN_ROOT_AVAIL_MB=128
  DEVCONTAINER_HEALTHCHECK_ARTIFACT_MAX_AGE_SECONDS=86400
USAGE
        exit 0
        ;;
esac

while [[ $# -gt 0 ]]; do
    case "${1:-}" in
        --brief)
            BRIEF="true"
            shift
            ;;
        --quiet)
            QUIET="true"
            shift
            ;;
        --strict)
            STRICT_MODE="true"
            shift
            ;;
        --no-cdp)
            CHECK_CDP="false"
            shift
            ;;
        --)
            shift
            break
            ;;
        *) shift ;;
    esac
done

# -----------------------------------------------------------------------------
# Configuration helpers
# -----------------------------------------------------------------------------
cfg_bool() {
    case "${1:-}" in
        true | TRUE | 1 | yes | YES | on | ON) printf 'true' ;;
        false | FALSE | 0 | no | NO | off | OFF) printf 'false' ;;
        *) printf '%s' "${2:-false}" ;;
    esac
}

cfg_uint() {
    local value fallback min max
    value="${1:-}"
    fallback="${2:-0}"
    min="${3:-0}"
    max="${4:-}"
    if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
        value="${fallback}"
    fi
    if ((value < min)); then
        value="${fallback}"
    fi
    if [[ -n "${max}" && "${max}" =~ ^[0-9]+$ && "${value}" =~ ^[0-9]+$ && value -gt max ]]; then
        value="${max}"
    fi
    printf '%s' "${value}"
}

is_uint() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

sanitize_oneline() {
    local value
    if [[ $# -gt 0 ]]; then
        value="$*"
    else
        value="$(LC_ALL=C awk 'BEGIN{ORS=""} {print; exit}' 2> /dev/null || true)"
    fi
    value="${value//$'\r'/ }"
    value="${value//$'\n'/ }"
    value="${value//$'\t'/ }"
    value="$(printf '%s' "${value}" | LC_ALL=C sed 's/[[:cntrl:]]//g' 2> /dev/null || true)"
    printf '%.4096s' "${value}"
}

lowercase() { printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'; }

now_epoch() { date '+%s' 2> /dev/null || printf '0'; }
ts() { date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date; }
has_cmd() { command -v "$1" > /dev/null 2>&1; }

cfg_bool_inplace() {
    cfg_bool "${1:-}" "${2:-false}"
}

STRICT_MODE="$(cfg_bool_inplace "${STRICT_MODE}" false)"
CHECK_CDP="$(cfg_bool_inplace "${CHECK_CDP}" true)"
WRITE_ARTIFACTS="$(cfg_bool_inplace "${WRITE_ARTIFACTS}" true)"

MIN_NODE_MAJOR="$(cfg_uint "${DEVCONTAINER_HEALTHCHECK_MIN_NODE_MAJOR:-24}" 24 0 99)"
REQUIRE_NPM="$(cfg_bool "${DEVCONTAINER_HEALTHCHECK_REQUIRE_NPM:-true}" true)"
NETWORK_FATAL="$(cfg_bool "${DEVCONTAINER_HEALTHCHECK_NETWORK_FATAL:-false}" false)"
ARTIFACT_MAX_AGE_SECONDS="$(cfg_uint "${DEVCONTAINER_HEALTHCHECK_ARTIFACT_MAX_AGE_SECONDS:-86400}" 86400 60 604800)"
CHECK_TIMEOUT_SECONDS="$(cfg_uint "${HEALTHCHECK_COMMAND_TIMEOUT_SECONDS:-${DEVCONTAINER_HEALTHCHECK_TIMEOUT_SECONDS:-3}}" 3 1 15)"
ROOT_USAGE_WARN_PERCENT="$(cfg_uint "${DEVCONTAINER_HEALTHCHECK_ROOT_USAGE_WARN_PERCENT:-90}" 90 1 100)"
ROOT_USAGE_FATAL_PERCENT="$(cfg_uint "${DEVCONTAINER_HEALTHCHECK_ROOT_USAGE_FATAL_PERCENT:-98}" 98 1 100)"
MIN_ROOT_AVAIL_MB="$(cfg_uint "${DEVCONTAINER_HEALTHCHECK_MIN_ROOT_AVAIL_MB:-128}" 128 0 1048576)"
REQUIRE_DUMB_INIT="$(cfg_bool "${DEVCONTAINER_HEALTHCHECK_REQUIRE_DUMB_INIT:-false}" false)"
EXPECT_NSS_WRAPPER="$(cfg_bool "${DEVCONTAINER_HEALTHCHECK_EXPECT_NSS_WRAPPER:-true}" true)"

HEALTH_STATUS_FILE="${DEVCONTAINER_HEALTH_STATUS_FILE:-/tmp/devcontainer-health.status}"
HEALTH_SUMMARY_FILE="${DEVCONTAINER_HEALTH_SUMMARY_FILE:-/tmp/devcontainer-health.summary}"
HEALTH_REPORT_FILE="${DEVCONTAINER_HEALTH_REPORT_FILE:-/tmp/devcontainer-health.report}"
HEALTH_EVENTS_FILE="${DEVCONTAINER_HEALTH_EVENTS_FILE:-/tmp/devcontainer-health.events.tsv}"

POST_START_SUMMARY_FILE="${DEVCONTAINER_POST_START_SUMMARY_FILE:-/tmp/devcontainer-post-start.summary}"
LOCAL_DNS_SUMMARY_FILE="${DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.summary}}"
LOCAL_DNS_STATUS_FILE="${DEVCONTAINER_LOCAL_DNS_STATUS_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_STATUS_FILE:-/tmp/devcontainer-local-dns-cache.status}}"
COPILOT_NETWORK_SUMMARY_FILE="${DEVCONTAINER_COPILOT_NETWORK_SUMMARY_FILE:-/tmp/devcontainer-copilot-network.summary}"
COPILOT_NETWORK_STATUS_FILE="${DEVCONTAINER_COPILOT_NETWORK_STATUS_FILE:-/tmp/devcontainer-copilot-network.status}"
GITHUB_ROUTE_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.summary}"
GITHUB_ROUTE_STATUS_FILE="${DEVCONTAINER_GITHUB_ROUTE_STATUS_FILE:-/tmp/devcontainer-github-api-route.status}"
LOCAL_PROXY_SUMMARY_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_SUMMARY_FILE:-/tmp/devcontainer-copilot-proxy.summary}"
LOCAL_PROXY_STATUS_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_FILE:-/tmp/devcontainer-copilot-proxy.status}"
ROUTE_ADVISOR_SUMMARY_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_SUMMARY_FILE:-/tmp/devcontainer-copilot-route-advisor.summary}"
ROUTE_ADVISOR_STATUS_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_STATUS_FILE:-/tmp/devcontainer-copilot-route-advisor.status}"

CHROME_HEALTH_ENDPOINT_RAW="${CHROME_HEALTH_BASE_URL:-${PUPPETEER_WS_ENDPOINT:-http://localhost:9224}}"
CHROME_CDP_PATH="${DEVCONTAINER_HEALTHCHECK_CDP_PATH:-/json/version}"

FATAL_COUNT=0
DEGRADED_COUNT=0
ADVISORY_COUNT=0
OK_COUNT=0
EVENT_COUNT=0
MAX_CONSOLE_EVENTS="$(cfg_uint "${DEVCONTAINER_HEALTHCHECK_MAX_CONSOLE_EVENTS:-24}" 24 0 200)"
FINAL_STATUS="unknown"
EXIT_CODE="${EXIT_HEALTHY}"

NODE_PATH_DETECTED="unknown"
NODE_VERSION_DETECTED="unknown"
NODE_MAJOR_DETECTED="unknown"
NPM_PATH_DETECTED="unknown"
NPM_VERSION_DETECTED="unknown"
PROJECT_ROOT="unknown"
ENDPOINT_REGISTRY_FILE="unknown"
ENDPOINT_REGISTRY_STATUS="unknown"
ENDPOINT_REGISTRY_ROWS="0"
ENDPOINT_REGISTRY_BAD_ROWS="0"

# -----------------------------------------------------------------------------
# IO helpers
# -----------------------------------------------------------------------------
ensure_parent_dir() {
    local path dir
    path="${1:-/tmp/unknown}"
    dir="$(dirname "${path}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${dir}" 2> /dev/null || true
}

safe_write_file() {
    local target mode dir tmp
    target="${1:-}"
    mode="${2:-0644}"
    [[ -n "${target}" ]] || return 1
    ensure_parent_dir "${target}"
    dir="$(dirname "${target}" 2> /dev/null || printf '/tmp')"
    tmp="$(mktemp "${dir%/}/.${SCRIPT_NAME}.XXXXXX" 2> /dev/null || true)"
    [[ -n "${tmp}" ]] || return 1
    cat > "${tmp}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
    chmod "${mode}" "${tmp}" 2> /dev/null || true
    mv -f "${tmp}" "${target}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
}

append_report() {
    [[ "${WRITE_ARTIFACTS}" == "true" ]] || return 0
    ensure_parent_dir "${HEALTH_REPORT_FILE}"
    printf '%s\n' "$*" >> "${HEALTH_REPORT_FILE}" 2> /dev/null || true
}

append_event_file() {
    [[ "${WRITE_ARTIFACTS}" == "true" ]] || return 0
    ensure_parent_dir "${HEALTH_EVENTS_FILE}"
    printf '%s\n' "$*" >> "${HEALTH_EVENTS_FILE}" 2> /dev/null || true
}

console_log() {
    local symbol level component message
    level="${1:-info}"
    component="${2:-core}"
    message="${3:-}"
    [[ "${QUIET}" == "true" ]] && return 0
    if [[ "${EVENT_COUNT}" -gt "${MAX_CONSOLE_EVENTS}" && "${MAX_CONSOLE_EVENTS}" -gt 0 ]]; then
        return 0
    fi
    case "${level}" in
        ok) symbol="✅" ;;
        fatal) symbol="❌" ;;
        degraded) symbol="⚠️" ;;
        advisory) symbol="ℹ️" ;;
        *) symbol="ℹ️" ;;
    esac
    printf '[healthcheck] %s %s: %s\n' "${symbol}" "${component}" "${message}" >&2
}

record_event() {
    local level component message safe_message
    level="${1:-advisory}"
    component="$(sanitize_oneline "${2:-core}")"
    message="$(sanitize_oneline "${3:-}")"
    safe_message="${message}"
    EVENT_COUNT=$((EVENT_COUNT + 1))
    case "${level}" in
        fatal)
            FATAL_COUNT=$((FATAL_COUNT + 1))
            ;;
        degraded)
            DEGRADED_COUNT=$((DEGRADED_COUNT + 1))
            ;;
        advisory)
            ADVISORY_COUNT=$((ADVISORY_COUNT + 1))
            ;;
        ok)
            OK_COUNT=$((OK_COUNT + 1))
            ;;
        *)
            ADVISORY_COUNT=$((ADVISORY_COUNT + 1))
            level="advisory"
            ;;
    esac
    append_event_file "$(ts)	${level}	${component}	${safe_message}"
    append_report "event level=${level} component=${component} message=${safe_message}"
    console_log "${level}" "${component}" "${safe_message}"
}

record_ok() { record_event ok "$1" "$2"; }
record_advisory() { record_event advisory "$1" "$2"; }
record_degraded() { record_event degraded "$1" "$2"; }
record_fatal() { record_event fatal "$1" "$2"; }

run_limited() {
    local seconds
    seconds="${1:-${CHECK_TIMEOUT_SECONDS}}"
    shift || true
    if has_cmd timeout; then
        timeout "${seconds}" "$@"
        return $?
    fi
    "$@"
}

read_first_line() {
    local file
    file="${1:-}"
    [[ -r "${file}" ]] || return 1
    awk 'NR==1{print; exit}' "${file}" 2> /dev/null | sanitize_oneline
}

kv_get() {
    local file key value
    file="${1:-}"
    key="${2:-}"
    [[ -r "${file}" && -n "${key}" ]] || return 1
    value="$(awk -v k="${key}" 'index($0, k "=") == 1 {sub(/^[^=]*=/, "", $0); print; exit}' "${file}" 2> /dev/null | sanitize_oneline)"
    [[ -n "${value}" ]] || return 1
    printf '%s\n' "${value}"
}

kv_or() {
    local value
    value="$(kv_get "${1:-}" "${2:-}" 2> /dev/null || true)"
    printf '%s\n' "${value:-${3:-unknown}}"
}

status_from_files() {
    local status_file summary_file key value
    status_file="${1:-}"
    summary_file="${2:-}"
    key="${3:-status}"
    value="$(kv_get "${summary_file}" "${key}" 2> /dev/null || true)"
    if [[ -z "${value}" ]]; then
        value="$(read_first_line "${status_file}" 2> /dev/null || true)"
    fi
    printf '%s\n' "${value:-unknown}"
}

file_mtime_epoch() {
    local file
    file="${1:-}"
    [[ -n "${file}" && -e "${file}" ]] || {
        printf '0'
        return 0
    }
    stat -c '%Y' "${file}" 2> /dev/null || printf '0'
}

file_age_seconds() {
    local file now mt age
    file="${1:-}"
    now="$(now_epoch)"
    mt="$(file_mtime_epoch "${file}")"
    if ! is_uint "${now}" || ! is_uint "${mt}" || ((mt <= 0 || now < mt)); then
        printf '0'
        return 0
    fi
    age=$((now - mt))
    printf '%s' "${age}"
}

file_is_stale() {
    local file age max_age
    file="${1:-}"
    max_age="${2:-${ARTIFACT_MAX_AGE_SECONDS}}"
    [[ -e "${file}" ]] || return 1
    age="$(file_age_seconds "${file}")"
    is_uint "${age}" || return 1
    ((age > max_age))
}

split_colon_to_lines() {
    local value old_ifs token
    value="${1:-}"
    old_ifs="${IFS}"
    IFS=':'
    for token in ${value}; do
        printf '%s\n' "${token}"
    done
    IFS="${old_ifs}"
}

safe_path_is_windows_mount() {
    [[ "${1:-}" =~ ^/mnt/[A-Za-z]/ ]]
}

# -----------------------------------------------------------------------------
# Project/root detection
# -----------------------------------------------------------------------------
detect_project_root() {
    local pwd_value git_root candidate registry_hint inferred_root workspace_candidate
    pwd_value="${PWD:-}"
    if [[ -n "${DEVCONTAINER_PROJECT_ROOT:-}" && -d "${DEVCONTAINER_PROJECT_ROOT:-}" ]]; then
        PROJECT_ROOT="${DEVCONTAINER_PROJECT_ROOT}"
        return 0
    fi

    registry_hint="${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE:-${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY:-${DEVCONTAINER_CANONICAL_ENDPOINT_REGISTRY:-}}}"
    if [[ "${registry_hint}" == */.devcontainer/* ]]; then
        inferred_root="${registry_hint%%/.devcontainer/*}"
        if [[ -n "${inferred_root}" && -d "${inferred_root}/.devcontainer" ]]; then
            PROJECT_ROOT="${inferred_root}"
            return 0
        fi
    fi

    for workspace_candidate in "${CONTAINER_WORKSPACE_FOLDER:-}" "${WORKSPACE_FOLDER:-}" "${LOCAL_WORKSPACE_FOLDER:-}"; do
        if [[ -n "${workspace_candidate}" && -d "${workspace_candidate}/.devcontainer" ]]; then
            PROJECT_ROOT="${workspace_candidate}"
            return 0
        fi
    done

    if [[ -n "${pwd_value}" && -d "${pwd_value}" ]] && has_cmd git; then
        git_root="$(git -C "${pwd_value}" rev-parse --show-toplevel 2> /dev/null || true)"
        if [[ -n "${git_root}" && -d "${git_root}" ]]; then
            PROJECT_ROOT="${git_root}"
            return 0
        fi
    fi

    for candidate in "${pwd_value}" "${pwd_value}/.." "/workspaces/${CONTAINER_WORKSPACE_FOLDER_BASENAME:-}" /workspaces/*; do
        [[ -n "${candidate}" && -d "${candidate}" ]] || continue
        if [[ -d "${candidate}/.devcontainer" || -f "${candidate}/Makefile" || -d "${candidate}/.git" ]]; then
            PROJECT_ROOT="$(cd "${candidate}" 2> /dev/null && pwd -P 2> /dev/null || printf '%s' "${candidate}")"
            return 0
        fi
    done
    PROJECT_ROOT="${pwd_value:-unknown}"
}

# -----------------------------------------------------------------------------
# Checks
# -----------------------------------------------------------------------------
check_core_commands() {
    local node_major npm_required major_raw
    if has_cmd bash; then
        record_ok core "bash disponível em $(command -v bash 2> /dev/null || printf bash)"
    else
        record_fatal core "bash indisponível"
    fi

    if has_cmd node; then
        NODE_PATH_DETECTED="$(command -v node 2> /dev/null || printf unknown)"
        if safe_path_is_windows_mount "${NODE_PATH_DETECTED}"; then
            record_fatal node "node resolve para binário Windows: ${NODE_PATH_DETECTED}"
        fi
        NODE_VERSION_DETECTED="$(run_limited "${CHECK_TIMEOUT_SECONDS}" node --version 2> /dev/null || true)"
        NODE_VERSION_DETECTED="$(sanitize_oneline "${NODE_VERSION_DETECTED}")"
        if [[ -z "${NODE_VERSION_DETECTED}" ]]; then
            record_fatal node "node existe, mas --version falhou"
        else
            major_raw="${NODE_VERSION_DETECTED#v}"
            node_major="${major_raw%%.*}"
            if is_uint "${node_major}"; then
                NODE_MAJOR_DETECTED="${node_major}"
                if ((MIN_NODE_MAJOR > 0 && node_major < MIN_NODE_MAJOR)); then
                    record_fatal node "Node.js ${NODE_VERSION_DETECTED} abaixo do mínimo exigido v${MIN_NODE_MAJOR}+"
                else
                    record_ok node "Node.js ${NODE_VERSION_DETECTED}; path=${NODE_PATH_DETECTED}"
                fi
            else
                record_degraded node "não foi possível interpretar versão do Node: ${NODE_VERSION_DETECTED}"
            fi
        fi
    else
        record_fatal node "Node.js não encontrado no PATH"
    fi

    npm_required="${REQUIRE_NPM}"
    if has_cmd npm; then
        NPM_PATH_DETECTED="$(command -v npm 2> /dev/null || printf unknown)"
        if safe_path_is_windows_mount "${NPM_PATH_DETECTED}"; then
            record_fatal npm "npm resolve para binário Windows: ${NPM_PATH_DETECTED}"
        fi
        NPM_VERSION_DETECTED="$(run_limited "${CHECK_TIMEOUT_SECONDS}" npm --version 2> /dev/null || true)"
        NPM_VERSION_DETECTED="$(sanitize_oneline "${NPM_VERSION_DETECTED}")"
        if [[ -n "${NPM_VERSION_DETECTED}" ]]; then
            record_ok npm "npm ${NPM_VERSION_DETECTED}; path=${NPM_PATH_DETECTED}"
        elif [[ "${npm_required}" == "true" ]]; then
            record_fatal npm "npm existe, mas --version falhou"
        else
            record_degraded npm "npm existe, mas --version falhou"
        fi
    elif [[ "${npm_required}" == "true" ]]; then
        record_fatal npm "npm não encontrado no PATH"
    else
        record_advisory npm "npm ausente, mas não exigido por configuração"
    fi

    if has_cmd dumb-init; then
        record_ok init "dumb-init disponível"
    elif [[ "${REQUIRE_DUMB_INIT}" == "true" ]]; then
        record_fatal init "dumb-init ausente e exigido"
    else
        record_advisory init "dumb-init ausente; não fatal para healthcheck"
    fi

    if has_cmd curl; then
        record_ok tools "curl disponível"
    else
        record_advisory tools "curl ausente; probes locais serão reduzidos"
    fi
    if has_cmd git; then
        record_ok tools "git disponível"
    else
        record_advisory tools "git ausente; detecção de root usa fallback"
    fi
}

check_identity_and_nss() {
    local uid user_name ld_preload token nss_count canonical_lib nss_passwd nss_group nss_seen
    uid="$(id -u 2> /dev/null || true)"
    user_name="$(id -un 2> /dev/null || true)"
    if [[ -z "${uid}" ]]; then
        record_fatal identity "id -u falhou"
    elif getent passwd "${uid}" > /dev/null 2>&1; then
        record_ok identity "UID ${uid} resolvível via getent"
    elif [[ -n "${user_name}" ]] && getent passwd "${user_name}" > /dev/null 2>&1; then
        record_ok identity "usuário ${user_name} resolvível via getent"
    else
        record_fatal identity "UID/usuário não resolvível via getent; NSS quebrado"
    fi

    if [[ -z "${HOME:-}" ]]; then
        record_fatal home "HOME não definido"
    elif [[ ! -d "${HOME}" ]]; then
        record_fatal home "HOME não é diretório: ${HOME}"
    elif [[ ! -w "${HOME}" ]]; then
        record_fatal home "HOME não é gravável: ${HOME}"
    else
        record_ok home "HOME gravável: ${HOME}"
    fi

    canonical_lib="${DEVCONTAINER_NSS_WRAPPER_LIB:-/usr/local/lib/devcontainer/libnss_wrapper.so}"
    nss_passwd="${NSS_WRAPPER_PASSWD:-}"
    nss_group="${NSS_WRAPPER_GROUP:-}"
    ld_preload="${LD_PRELOAD:-}"
    nss_count=0
    nss_seen="false"

    if [[ -n "${ld_preload}" ]]; then
        if [[ "${ld_preload}" == ':'* || "${ld_preload}" == *':' || "${ld_preload}" == *'::'* ]]; then
            record_degraded nss "LD_PRELOAD contém token vazio"
        fi
        while IFS= read -r token; do
            [[ -n "${token}" ]] || continue
            case "${token}" in
                libnss_wrapper.so)
                    nss_count=$((nss_count + 1))
                    nss_seen="true"
                    record_fatal nss "LD_PRELOAD contém libnss_wrapper.so relativo; esperado caminho absoluto"
                    ;;
                */libnss_wrapper.so)
                    nss_count=$((nss_count + 1))
                    nss_seen="true"
                    if [[ ! -r "${token}" ]]; then
                        record_fatal nss "LD_PRELOAD aponta NSS wrapper ilegível: ${token}"
                    elif [[ "${token}" == "${canonical_lib}" ]]; then
                        record_ok nss "LD_PRELOAD contém NSS wrapper canônico"
                    else
                        record_degraded nss "LD_PRELOAD contém NSS wrapper não canônico: ${token}"
                    fi
                    ;;
                */*)
                    if [[ ! -r "${token}" ]]; then
                        record_fatal preload "LD_PRELOAD contém biblioteca ilegível: ${token}"
                    fi
                    ;;
            esac
        done < <(split_colon_to_lines "${ld_preload}")
    fi

    if ((nss_count > 1)); then
        record_degraded nss "múltiplos tokens libnss_wrapper.so em LD_PRELOAD"
    fi

    if [[ "${EXPECT_NSS_WRAPPER}" == "true" ]]; then
        if [[ -r "${canonical_lib}" ]]; then
            record_ok nss "biblioteca NSS canônica legível: ${canonical_lib}"
        else
            record_degraded nss "biblioteca NSS canônica ausente/ilegível: ${canonical_lib}"
        fi
        if [[ "${nss_seen}" != "true" ]]; then
            record_degraded nss "LD_PRELOAD não contém NSS wrapper; identidade pode depender de /etc/passwd"
        fi
        if [[ "${nss_seen}" == "true" ]]; then
            if [[ -n "${nss_passwd}" && -s "${nss_passwd}" && -r "${nss_passwd}" ]]; then
                record_ok nss "NSS_WRAPPER_PASSWD legível"
            else
                record_fatal nss "NSS wrapper ativo, mas NSS_WRAPPER_PASSWD ausente/vazio/ilegível"
            fi
            if [[ -n "${nss_group}" && -s "${nss_group}" && -r "${nss_group}" ]]; then
                record_ok nss "NSS_WRAPPER_GROUP legível"
            else
                record_fatal nss "NSS wrapper ativo, mas NSS_WRAPPER_GROUP ausente/vazio/ilegível"
            fi
        fi
    fi
}

check_filesystem() {
    local usage_pct avail_k avail_mb tmp_probe
    if [[ -d /tmp && -w /tmp ]]; then
        tmp_probe="$(mktemp /tmp/devcontainer-health.XXXXXX 2> /dev/null || true)"
        if [[ -n "${tmp_probe}" ]]; then
            rm -f "${tmp_probe}" 2> /dev/null || true
            record_ok fs "/tmp gravável"
        else
            record_fatal fs "/tmp existe, mas mktemp falhou"
        fi
    else
        record_fatal fs "/tmp ausente ou não gravável"
    fi

    usage_pct="$(df -P / 2> /dev/null | awk 'NR==2 {gsub(/%/, "", $5); print $5; exit}' || printf '')"
    avail_k="$(df -Pk / 2> /dev/null | awk 'NR==2 {print $4; exit}' || printf '')"
    if is_uint "${avail_k}"; then
        avail_mb=$((avail_k / 1024))
    else
        avail_mb=0
    fi
    if is_uint "${usage_pct}"; then
        if ((usage_pct >= ROOT_USAGE_FATAL_PERCENT)); then
            record_fatal fs "uso de disco crítico: ${usage_pct}% usado, ${avail_mb}MiB livres"
        elif ((MIN_ROOT_AVAIL_MB > 0 && avail_mb < MIN_ROOT_AVAIL_MB)); then
            record_fatal fs "espaço livre crítico: ${avail_mb}MiB < ${MIN_ROOT_AVAIL_MB}MiB"
        elif ((usage_pct >= ROOT_USAGE_WARN_PERCENT)); then
            record_degraded fs "uso de disco alto: ${usage_pct}% usado, ${avail_mb}MiB livres"
        else
            record_ok fs "disco OK: ${usage_pct}% usado, ${avail_mb}MiB livres"
        fi
    else
        record_advisory fs "não foi possível ler df /"
    fi
}

check_structural_manifest() {
    local manifest status integrity mismatch version
    manifest="${DEVCONTAINER_STATE_MANIFEST:-${PROJECT_ROOT}/.devcontainer/.initialized}"
    if [[ ! -r "${manifest}" ]]; then
        record_degraded manifest "manifesto estrutural ausente: ${manifest}"
        return 0
    fi
    status="$(kv_or "${manifest}" status unknown)"
    integrity="$(kv_or "${manifest}" integrity unknown)"
    mismatch="$(kv_or "${manifest}" version_mismatch_count 0)"
    version="$(kv_or "${manifest}" script_version unknown)"
    case "${status}" in
        ready | ok | canonical)
            record_ok manifest "status=${status}; post-create=${version}; integrity=${integrity}; mismatches=${mismatch}"
            ;;
        fatal | failed | unhealthy)
            record_fatal manifest "manifesto relata status fatal: ${status}; integrity=${integrity}"
            ;;
        *)
            record_degraded manifest "status estrutural não-canônico: ${status}; integrity=${integrity}; mismatches=${mismatch}"
            ;;
    esac
    if [[ "${integrity}" == "failed" || "${integrity}" == "fail" ]]; then
        record_fatal manifest "integridade estrutural falhou"
    elif is_uint "${mismatch}" && ((mismatch > 0)); then
        record_degraded manifest "manifesto relata ${mismatch} mismatch(es) de versão/contrato"
    fi
}

audit_endpoint_registry() {
    local file rows bad canonical legacy
    canonical="${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE:-${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY:-${PROJECT_ROOT}/.devcontainer/scripts/network/endpoints.github-copilot.tsv}}"
    legacy="${PROJECT_ROOT}/.devcontainer/network/endpoints.github-copilot.tsv"
    if [[ -r "${canonical}" ]]; then
        file="${canonical}"
    elif [[ -r "${legacy}" ]]; then
        file="${legacy}"
    else
        file="${canonical}"
    fi
    ENDPOINT_REGISTRY_FILE="${file}"
    if [[ ! -r "${file}" ]]; then
        ENDPOINT_REGISTRY_STATUS="missing"
        record_degraded registry "endpoint registry ausente: ${file}"
        return 0
    fi
    rows="$(awk -F'\t' '/^[[:space:]]*#/ || /^[[:space:]]*$/ {next} {c++} END{print c+0}' "${file}" 2> /dev/null || printf '0')"
    bad="$(awk -F'\t' '
        /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
        NF != 5 { bad++; next }
        $1 !~ /^https:\/\// { bad++; next }
        $1 ~ /[[:space:]\\]/ { bad++; next }
        $1 ~ /@/ { bad++; next }
        $2 == "" || $3 == "" || $4 == "" || $5 == "" { bad++; next }
        END { print bad+0 }
    ' "${file}" 2> /dev/null || printf '0')"
    ENDPOINT_REGISTRY_ROWS="${rows:-0}"
    ENDPOINT_REGISTRY_BAD_ROWS="${bad:-0}"
    if ! is_uint "${rows}" || ((rows <= 0)); then
        ENDPOINT_REGISTRY_STATUS="empty"
        record_degraded registry "endpoint registry vazio: ${file}"
    elif ! is_uint "${bad}" || ((bad > 0)); then
        ENDPOINT_REGISTRY_STATUS="invalid"
        record_degraded registry "endpoint registry inválido: rows=${rows}; bad=${bad}; file=${file}"
    else
        ENDPOINT_REGISTRY_STATUS="ok"
        record_ok registry "endpoint registry OK: rows=${rows}; file=${file}"
    fi
    if file_is_stale "${file}" "604800"; then
        record_advisory registry "endpoint registry existe, mas parece antigo (>7d): ${file}"
    fi
}

inspect_core_lifecycle_summary() {
    local label file status reason age
    label="${1:-component}"
    file="${2:-}"
    if [[ ! -r "${file}" ]]; then
        record_degraded "${label}" "summary ausente: ${file}"
        return 0
    fi
    status="$(kv_or "${file}" status unknown)"
    reason="$(kv_or "${file}" reason none)"
    age="$(file_age_seconds "${file}")"
    case "${status}" in
        ok | ready | canonical)
            record_ok "${label}" "status=${status}; age=${age}s"
            ;;
        fatal | unhealthy)
            record_fatal "${label}" "status=${status}; reason=${reason}"
            ;;
        failed | fail | error)
            record_fatal "${label}" "status=${status}; reason=${reason}"
            ;;
        degraded | stale)
            record_degraded "${label}" "status=${status}; reason=${reason}; age=${age}s"
            ;;
        off | skipped | disabled)
            record_advisory "${label}" "status=${status}; reason=${reason}"
            ;;
        *)
            record_advisory "${label}" "status=${status}; reason=${reason}; age=${age}s"
            ;;
    esac
}

inspect_observational_component() {
    local label status_file summary_file status reason age severity missing_severity
    label="${1:-component}"
    status_file="${2:-}"
    summary_file="${3:-}"
    severity="${4:-degraded}"
    missing_severity="${5:-advisory}"
    if [[ ! -r "${summary_file}" && ! -r "${status_file}" ]]; then
        if [[ "${missing_severity}" == "degraded" ]]; then
            record_degraded "${label}" "artifact ausente: ${summary_file}"
        else
            record_advisory "${label}" "artifact ausente: ${summary_file}"
        fi
        return 0
    fi
    status="$(status_from_files "${status_file}" "${summary_file}" status)"
    reason="$(kv_or "${summary_file}" reason none)"
    age="$(file_age_seconds "${summary_file}")"
    if [[ -r "${summary_file}" ]] && file_is_stale "${summary_file}" "${ARTIFACT_MAX_AGE_SECONDS}"; then
        record_advisory "${label}" "artifact stale: status=${status}; age=${age}s"
    fi
    case "${status}" in
        ok | ready | canonical)
            record_ok "${label}" "status=${status}; age=${age}s"
            ;;
        off | skipped | disabled | stopped | env-only)
            record_advisory "${label}" "status=${status}; reason=${reason}"
            ;;
        fatal | unhealthy)
            if [[ "${NETWORK_FATAL}" == "true" || "${severity}" == "fatal" ]]; then
                record_fatal "${label}" "status=${status}; reason=${reason}"
            else
                record_degraded "${label}" "status=${status}; reason=${reason}"
            fi
            ;;
        failed | fail | error | degraded | stale | conflict | lock-failed | compare-failed | benchmark-failed)
            if [[ "${NETWORK_FATAL}" == "true" || "${severity}" == "fatal" ]]; then
                record_fatal "${label}" "status=${status}; reason=${reason}"
            else
                record_degraded "${label}" "status=${status}; reason=${reason}"
            fi
            ;;
        *)
            record_advisory "${label}" "status=${status}; reason=${reason}; age=${age}s"
            ;;
    esac
}

inspect_network_semantics() {
    local dns_enabled dns_runtime dns_resolver dns_points dns_prev_stale dns_status manager_overall proxy_action advisor_configured route_verify route_status

    dns_enabled="$(cfg_bool "${DEVCONTAINER_ENABLE_LOCAL_DNS_CACHE:-false}" false)"
    if [[ -r "${LOCAL_DNS_SUMMARY_FILE}" ]]; then
        dns_status="$(status_from_files "${LOCAL_DNS_STATUS_FILE}" "${LOCAL_DNS_SUMMARY_FILE}" status)"
        dns_runtime="$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" runtime_effective unknown)"
        dns_resolver="$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" resolver_effective unknown)"
        dns_points="$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" resolv_conf_points_to_cache unknown)"
        dns_prev_stale="$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" previous_summary_stale unknown)"
        if [[ "${dns_enabled}" == "true" ]]; then
            if [[ "${dns_status}" == "ok" && "${dns_runtime}" == "true" && "${dns_resolver}" == "true" ]]; then
                record_ok dns "DNS cache efetivo: runtime=true; resolver=true"
            elif [[ "${dns_status}" == "off" ]]; then
                record_degraded dns "DNS cache habilitado, mas summary relata off"
            else
                record_degraded dns "DNS cache não plenamente efetivo: status=${dns_status}; runtime=${dns_runtime}; resolver=${dns_resolver}; points=${dns_points}"
            fi
        else
            record_advisory dns "DNS cache não exigido; status=${dns_status}; runtime=${dns_runtime}; resolver=${dns_resolver}"
        fi
        if [[ "${dns_prev_stale}" == "true" ]]; then
            record_advisory dns "summary DNS anterior era stale; runtime atual deve prevalecer"
        fi
    elif [[ "${dns_enabled}" == "true" ]]; then
        record_degraded dns "DNS cache habilitado, mas summary ausente"
    else
        record_advisory dns "DNS cache desabilitado e sem summary"
    fi

    if [[ -r "${COPILOT_NETWORK_SUMMARY_FILE}" ]]; then
        manager_overall="$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" plane_overall_status unknown)"
        proxy_action="$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" local_proxy_recommendation_action unknown)"
        case "${manager_overall}" in
            ok)
                record_ok manager "plano GitHub/Copilot OK; proxy_action=${proxy_action}"
                ;;
            degraded | partial | stale)
                record_degraded manager "plano GitHub/Copilot ${manager_overall}; proxy_action=${proxy_action}"
                ;;
            failed | fatal | unhealthy)
                if [[ "${NETWORK_FATAL}" == "true" ]]; then
                    record_fatal manager "plano GitHub/Copilot ${manager_overall}"
                else
                    record_degraded manager "plano GitHub/Copilot ${manager_overall}"
                fi
                ;;
            *)
                record_advisory manager "plano GitHub/Copilot ${manager_overall}"
                ;;
        esac
    fi

    if [[ -r "${GITHUB_ROUTE_SUMMARY_FILE}" ]]; then
        route_verify="$(kv_or "${GITHUB_ROUTE_SUMMARY_FILE}" verify_status unknown)"
        route_status="$(status_from_files "${GITHUB_ROUTE_STATUS_FILE}" "${GITHUB_ROUTE_SUMMARY_FILE}" status)"
        case "${route_verify}:${route_status}" in
            ok:* | *:ok)
                record_ok route "route-fix observado: verify=${route_verify}; status=${route_status}"
                ;;
            failed:* | fail:* | *:failed | *:degraded)
                record_degraded route "route-fix degradado: verify=${route_verify}; status=${route_status}"
                ;;
            *)
                record_advisory route "route-fix snapshot: verify=${route_verify}; status=${route_status}"
                ;;
        esac
    fi

    if [[ -r "${ROUTE_ADVISOR_SUMMARY_FILE}" ]]; then
        advisor_configured="$(kv_or "${ROUTE_ADVISOR_SUMMARY_FILE}" endpoints_configured_count 0)"
        if is_uint "${advisor_configured}" && ((advisor_configured == 0)); then
            record_advisory advisor "advisor sem endpoints configurados; normal se nunca executado ou filtrado"
        fi
    fi
}

normalize_cdp_base_url() {
    local raw proto rest authority
    raw="${1:-http://localhost:9224}"
    case "${raw}" in
        ws://*) raw="http://${raw#ws://}" ;;
        wss://*) raw="https://${raw#wss://}" ;;
    esac
    if [[ "${raw}" != *://* ]]; then
        raw="http://${raw}"
    fi
    proto="${raw%%://*}"
    rest="${raw#*://}"
    authority="${rest%%/*}"
    [[ -n "${authority}" ]] || authority="localhost:9224"
    printf '%s://%s' "${proto}" "${authority}"
}

url_authority_host() {
    local url rest authority host
    url="${1:-}"
    rest="${url#*://}"
    authority="${rest%%/*}"
    if [[ "${authority}" == \[*\]* ]]; then
        host="${authority#\[}"
        host="${host%%\]*}"
    else
        host="${authority%%:*}"
    fi
    lowercase "${host}"
}

is_local_probe_host() {
    local host
    host="$(lowercase "${1:-}")"
    case "${host}" in
        localhost | 127.* | ::1 | host.docker.internal) return 0 ;;
        *) return 1 ;;
    esac
}

check_cdp_local_advisory() {
    local base host url
    [[ "${CHECK_CDP}" == "true" ]] || {
        record_advisory cdp "probe CDP ignorado por configuração"
        return 0
    }
    if ! has_cmd curl; then
        record_advisory cdp "curl ausente; probe CDP local ignorado"
        return 0
    fi
    base="$(normalize_cdp_base_url "${CHROME_HEALTH_ENDPOINT_RAW}")"
    host="$(url_authority_host "${base}")"
    if ! is_local_probe_host "${host}"; then
        record_advisory cdp "endpoint CDP não-local; não será sondado pelo healthcheck: ${base}"
        return 0
    fi
    url="${base%/}${CHROME_CDP_PATH}"
    if run_limited "${CHECK_TIMEOUT_SECONDS}" curl -fsS --noproxy '*' --connect-timeout 1 --max-time "${CHECK_TIMEOUT_SECONDS}" "${url}" > /dev/null 2>&1; then
        record_ok cdp "Chrome/CDP local acessível: ${base}"
    else
        record_advisory cdp "Chrome/CDP local indisponível; normal antes de iniciar o sistema: ${base}"
    fi
}

check_environment_shape() {
    local missing var critical_vars
    missing=0
    critical_vars="NODE_ENV SERVER_MODE SERVER_AUTHORITY BROWSER_MODE SERVER_PORT"
    for var in ${critical_vars}; do
        if [[ -z "${!var:-}" ]]; then
            missing=$((missing + 1))
        fi
    done
    if ((missing == 0)); then
        record_ok env "remoteEnv crítico presente"
    else
        record_degraded env "${missing} variável(is) crítica(s) de remoteEnv ausente(s)"
    fi

    if [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
        if [[ -S "${SSH_AUTH_SOCK}" ]]; then
            record_ok ssh "SSH_AUTH_SOCK aponta para socket"
        else
            record_advisory ssh "SSH_AUTH_SOCK definido, mas não é socket"
        fi
    else
        record_advisory ssh "SSH_AUTH_SOCK ausente; não fatal"
    fi
}

check_lifecycle_and_network_artifacts() {
    inspect_core_lifecycle_summary post-start "${POST_START_SUMMARY_FILE}"
    inspect_observational_component local-dns "${LOCAL_DNS_STATUS_FILE}" "${LOCAL_DNS_SUMMARY_FILE}" degraded advisory
    inspect_observational_component copilot-manager "${COPILOT_NETWORK_STATUS_FILE}" "${COPILOT_NETWORK_SUMMARY_FILE}" degraded advisory
    inspect_observational_component github-route "${GITHUB_ROUTE_STATUS_FILE}" "${GITHUB_ROUTE_SUMMARY_FILE}" degraded advisory
    inspect_observational_component local-proxy "${LOCAL_PROXY_STATUS_FILE}" "${LOCAL_PROXY_SUMMARY_FILE}" degraded advisory
    inspect_observational_component route-advisor "${ROUTE_ADVISOR_STATUS_FILE}" "${ROUTE_ADVISOR_SUMMARY_FILE}" degraded advisory
    inspect_network_semantics
}

compute_final_status() {
    if [[ "${STRICT_MODE}" == "true" && "${DEGRADED_COUNT}" -gt 0 ]]; then
        FATAL_COUNT=$((FATAL_COUNT + DEGRADED_COUNT))
        DEGRADED_COUNT=0
        append_report "strict_mode=promoted-degraded-to-fatal"
    fi
    if ((FATAL_COUNT > 0)); then
        FINAL_STATUS="fatal"
        EXIT_CODE="${EXIT_UNHEALTHY}"
    elif ((DEGRADED_COUNT > 0)); then
        FINAL_STATUS="degraded"
        EXIT_CODE="${EXIT_HEALTHY}"
    else
        FINAL_STATUS="ok"
        EXIT_CODE="${EXIT_HEALTHY}"
    fi
}

write_artifacts() {
    local docker_status completed_at
    [[ "${WRITE_ARTIFACTS}" == "true" ]] || return 0
    completed_at="$(ts)"
    if [[ "${EXIT_CODE}" -eq 0 ]]; then
        docker_status="healthy"
    else
        docker_status="unhealthy"
    fi
    printf '%s\n' "${FINAL_STATUS}" | safe_write_file "${HEALTH_STATUS_FILE}" 0644 || true
    {
        printf 'status=%s\n' "${FINAL_STATUS}"
        printf 'docker_status=%s\n' "${docker_status}"
        printf 'exit_code=%s\n' "${EXIT_CODE}"
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'script_version=%s\n' "${SCRIPT_VERSION}"
        printf 'strict_mode=%s\n' "${STRICT_MODE}"
        printf 'network_fatal=%s\n' "${NETWORK_FATAL}"
        printf 'fatal_count=%s\n' "${FATAL_COUNT}"
        printf 'degraded_count=%s\n' "${DEGRADED_COUNT}"
        printf 'advisory_count=%s\n' "${ADVISORY_COUNT}"
        printf 'ok_count=%s\n' "${OK_COUNT}"
        printf 'event_count=%s\n' "${EVENT_COUNT}"
        printf 'node_path=%s\n' "${NODE_PATH_DETECTED}"
        printf 'node_version=%s\n' "${NODE_VERSION_DETECTED}"
        printf 'node_major=%s\n' "${NODE_MAJOR_DETECTED}"
        printf 'min_node_major=%s\n' "${MIN_NODE_MAJOR}"
        printf 'npm_path=%s\n' "${NPM_PATH_DETECTED}"
        printf 'npm_version=%s\n' "${NPM_VERSION_DETECTED}"
        printf 'project_root=%s\n' "${PROJECT_ROOT}"
        printf 'endpoint_registry_file=%s\n' "${ENDPOINT_REGISTRY_FILE}"
        printf 'endpoint_registry_status=%s\n' "${ENDPOINT_REGISTRY_STATUS}"
        printf 'endpoint_registry_rows=%s\n' "${ENDPOINT_REGISTRY_ROWS}"
        printf 'endpoint_registry_bad_rows=%s\n' "${ENDPOINT_REGISTRY_BAD_ROWS}"
        printf 'post_start_summary=%s\n' "${POST_START_SUMMARY_FILE}"
        printf 'local_dns_summary=%s\n' "${LOCAL_DNS_SUMMARY_FILE}"
        printf 'copilot_network_summary=%s\n' "${COPILOT_NETWORK_SUMMARY_FILE}"
        printf 'github_route_summary=%s\n' "${GITHUB_ROUTE_SUMMARY_FILE}"
        printf 'local_proxy_summary=%s\n' "${LOCAL_PROXY_SUMMARY_FILE}"
        printf 'route_advisor_summary=%s\n' "${ROUTE_ADVISOR_SUMMARY_FILE}"
        printf 'health_status_file=%s\n' "${HEALTH_STATUS_FILE}"
        printf 'health_report_file=%s\n' "${HEALTH_REPORT_FILE}"
        printf 'health_events_file=%s\n' "${HEALTH_EVENTS_FILE}"
        printf 'completed_at=%s\n' "${completed_at}"
    } | safe_write_file "${HEALTH_SUMMARY_FILE}" 0644 || true
}

write_report_header() {
    [[ "${WRITE_ARTIFACTS}" == "true" ]] || return 0
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'strict_mode=%s\n' "${STRICT_MODE}"
        printf 'min_node_major=%s\n' "${MIN_NODE_MAJOR}"
        printf 'require_npm=%s\n' "${REQUIRE_NPM}"
        printf 'network_fatal=%s\n' "${NETWORK_FATAL}"
        printf 'check_cdp=%s\n' "${CHECK_CDP}"
        printf 'artifact_max_age_seconds=%s\n' "${ARTIFACT_MAX_AGE_SECONDS}"
        printf 'project_root=%s\n' "${PROJECT_ROOT}"
        printf '\n'
    } | safe_write_file "${HEALTH_REPORT_FILE}" 0644 || true
    printf 'timestamp\tlevel\tcomponent\tmessage\n' | safe_write_file "${HEALTH_EVENTS_FILE}" 0644 || true
}

print_final() {
    local docker_status
    if [[ "${EXIT_CODE}" -eq 0 ]]; then
        docker_status="healthy"
    else
        docker_status="unhealthy"
    fi
    if [[ "${QUIET}" == "true" ]]; then
        printf 'status=%s docker_status=%s exit_code=%s fatal=%s degraded=%s advisory=%s ok=%s\n' \
            "${FINAL_STATUS}" "${docker_status}" "${EXIT_CODE}" "${FATAL_COUNT}" "${DEGRADED_COUNT}" "${ADVISORY_COUNT}" "${OK_COUNT}" >&2
        return 0
    fi
    printf '[healthcheck] RESULT status=%s docker_status=%s exit_code=%s fatal=%s degraded=%s advisory=%s ok=%s summary=%s\n' \
        "${FINAL_STATUS}" "${docker_status}" "${EXIT_CODE}" "${FATAL_COUNT}" "${DEGRADED_COUNT}" "${ADVISORY_COUNT}" "${OK_COUNT}" "${HEALTH_SUMMARY_FILE}" >&2
}

main() {
    detect_project_root
    write_report_header
    [[ "${BRIEF}" != "true" && "${QUIET}" != "true" ]] && printf '[healthcheck] %s v%s started; project_root=%s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "${PROJECT_ROOT}" >&2

    check_core_commands
    check_identity_and_nss
    check_filesystem
    check_structural_manifest
    audit_endpoint_registry
    check_environment_shape
    check_lifecycle_and_network_artifacts
    check_cdp_local_advisory

    compute_final_status
    write_artifacts
    print_final
    return "${EXIT_CODE}"
}

main "$@"
exit $?
