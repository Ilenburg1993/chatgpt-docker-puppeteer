#!/usr/bin/env bash
# =============================================================================
# post-start.sh — DevContainer Start Hook (Fail-Safe Network/NSS Orchestrator)
# Version: v2.8.1
#
# Purpose:
#   Runtime-only DevContainer post-start orchestration for a GitHub/Copilot-first
#   development environment.
#
# Contract:
#   - Always exits 0. DevContainer start/attach must never be blocked by this hook.
#   - Never starts application services automatically.
#   - Never performs destructive structural mutations: no recursive chown, no
#     mount rewrites, no Docker/DevContainer topology changes.
#   - Only bounded runtime mutations are allowed:
#       * optional /etc/resolv.conf content rewrite, preserving inode;
#       * optional delegated api.github.com /etc/hosts managed block via
#         .devcontainer/scripts/network/github-api-route-fix.sh;
#       * optional delegated local DNS/proxy/network manager scripts, if present
#         and explicitly enabled by DEVCONTAINER_* flags.
#   - Subscripts are invoked through bash, not by executable bit, to survive
#     Windows/WSL/Git mode regressions. Scripts should still be versioned 100755.
#   - Designed to be called by devcontainer.json postStartCommand.
#
# Architecture:
#   1. Canonicalize NSS/LD_PRELOAD for hook subprocesses.
#   2. Repair/audit lightweight runtime NSS artifacts.
#   3. Establish DNS baseline or delegate to optional local DNS cache manager.
#   4. Observe or optionally start local Copilot proxy without exporting it globally.
#   5. Read cached benchmark/recommendation artifacts from manual long jobs.
#   6. Delegate GitHub/Copilot network orchestration when enabled.
#   7. Fallback to legacy api.github.com route fix + passive probes.
#   8. Run passive structural diagnostics only.
# v2.8.1 focus:
#   - Synchronizes with github-api-route-fix.sh v1.8.6, local-dns-cache.sh
#     v1.5.3, local-copilot-proxy.sh v1.2.3, github-copilot-network-manager.sh
#     v1.5.3 and endpoints.github-copilot.tsv v1.1.0.
#   - Keeps benchmark/compare jobs out of boot by sanitizing post-start actions
#     before delegating to route-fix, DNS cache, proxy and network manager.
#   - Adds endpoint registry consumption for legacy probes, so fallback probing
#     remains coherent with the manager's official Copilot allowlist surface.
#   - Fails closed for local DNS cache activation: /etc/resolv.conf is only
#     treated as safe when dnsmasq, resolver health and status freshness agree.
#   - Surfaces route/proxy/manager freshness, soft-degraded counters and DNS
#     runtime proof fields in post-start summary/report for post-attach use.
# =============================================================================

# Fail-safe shell posture. This script may be launched by strict parent shells,
# partial environments, or VS Code bootstrap paths. It must tolerate all of them.
set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

# -----------------------------------------------------------------------------
# CLI read-only helpers
# -----------------------------------------------------------------------------
case "${1:-}" in
    --version)
        printf '%s v%s\n' 'post-start.sh' '2.8.1'
        exit 0
        ;;
    --help)
        cat << 'USAGE'
post-start.sh [--help] [--version]

Fail-safe DevContainer postStart hook. It performs only bounded runtime
network/NSS orchestration and always exits 0 during normal hook execution.
Long-running benchmark/compare jobs are intentionally not run from post-start;
use npm run network:* or make network-* for prolonged benchmark collection.
USAGE
        exit 0
        ;;
esac

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

# -----------------------------------------------------------------------------
# Constants / sanitized config
# -----------------------------------------------------------------------------
SCRIPT_NAME="post-start.sh"
readonly SCRIPT_NAME
SCRIPT_VERSION="2.8.1"
readonly SCRIPT_VERSION

SCRIPT_DIR=""
if SCRIPT_DIR_TMP="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2> /dev/null && pwd -P 2> /dev/null)"; then
    SCRIPT_DIR="${SCRIPT_DIR_TMP}"
else
    SCRIPT_DIR="$(pwd -P 2> /dev/null || printf '.')"
fi
readonly SCRIPT_DIR

PROJECT_ROOT=""
if PROJECT_ROOT_TMP="$(cd "${SCRIPT_DIR}/../.." 2> /dev/null && pwd -P 2> /dev/null)"; then
    PROJECT_ROOT="${PROJECT_ROOT_TMP}"
else
    PROJECT_ROOT="${PWD:-/workspaces/chatgpt-docker-puppeteer}"
fi
readonly PROJECT_ROOT

HEALTH_STATUS_FILE="${DEVCONTAINER_HEALTH_STATUS_FILE:-/tmp/devcontainer-health.status}"
readonly HEALTH_STATUS_FILE
NETWORK_STATUS_FILE="${DEVCONTAINER_NETWORK_STATUS_FILE:-/tmp/devcontainer-network.status}"
readonly NETWORK_STATUS_FILE
DIAGNOSTICS_STATUS_FILE="${DEVCONTAINER_DIAGNOSTICS_STATUS_FILE:-/tmp/devcontainer-diagnostics.status}"
readonly DIAGNOSTICS_STATUS_FILE
HEALTH_ERROR_LOG="${DEVCONTAINER_HEALTH_ERROR_LOG:-${HEALTH_STATUS_FILE}.error.log}"
readonly HEALTH_ERROR_LOG

GITHUB_ROUTE_REPORT_FILE="${DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE:-/tmp/devcontainer-github-api-route.report}"
readonly GITHUB_ROUTE_REPORT_FILE
GITHUB_ROUTE_STATUS_FILE="${DEVCONTAINER_GITHUB_ROUTE_STATUS_FILE:-/tmp/devcontainer-github-api-route.status}"
readonly GITHUB_ROUTE_STATUS_FILE
GITHUB_ROUTE_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.summary}"
readonly GITHUB_ROUTE_SUMMARY_FILE
GITHUB_ROUTE_METRICS_FILE="${DEVCONTAINER_GITHUB_ROUTE_METRICS_FILE:-/tmp/devcontainer-github-api-route.metrics.tsv}"
readonly GITHUB_ROUTE_METRICS_FILE
GITHUB_ROUTE_BENCHMARK_FILE="${DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_FILE:-/tmp/devcontainer-github-api-route.benchmark.tsv}"
readonly GITHUB_ROUTE_BENCHMARK_FILE
GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.benchmark.summary}"
readonly GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE
GITHUB_ROUTE_RECOMMENDATION_FILE="${DEVCONTAINER_GITHUB_ROUTE_RECOMMENDATION_FILE:-/tmp/devcontainer-github-api-route.recommendation}"
readonly GITHUB_ROUTE_RECOMMENDATION_FILE
COPILOT_NETWORK_REPORT_FILE="${DEVCONTAINER_COPILOT_NETWORK_REPORT_FILE:-/tmp/devcontainer-copilot-network.report}"
readonly COPILOT_NETWORK_REPORT_FILE
COPILOT_NETWORK_METRICS_FILE="${DEVCONTAINER_COPILOT_NETWORK_METRICS_FILE:-/tmp/devcontainer-copilot-network.metrics.tsv}"
readonly COPILOT_NETWORK_METRICS_FILE
COPILOT_NETWORK_STATUS_FILE="${DEVCONTAINER_COPILOT_NETWORK_STATUS_FILE:-/tmp/devcontainer-copilot-network.status}"
readonly COPILOT_NETWORK_STATUS_FILE
COPILOT_NETWORK_SUMMARY_FILE="${DEVCONTAINER_COPILOT_NETWORK_SUMMARY_FILE:-/tmp/devcontainer-copilot-network.summary}"
readonly COPILOT_NETWORK_SUMMARY_FILE
COPILOT_NETWORK_DIAGNOSIS_FILE="${DEVCONTAINER_COPILOT_NETWORK_DIAGNOSIS_FILE:-/tmp/devcontainer-copilot-network.diagnosis.tsv}"
readonly COPILOT_NETWORK_DIAGNOSIS_FILE
COPILOT_NETWORK_RECOMMENDATION_FILE="${DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_FILE:-/tmp/devcontainer-copilot-network.recommendation}"
readonly COPILOT_NETWORK_RECOMMENDATION_FILE
COPILOT_NETWORK_RECOMMENDATION_JSON_FILE="${DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_JSON_FILE:-/tmp/devcontainer-copilot-network.recommendation.json}"
readonly COPILOT_NETWORK_RECOMMENDATION_JSON_FILE
LOCAL_DNS_CACHE_STATUS_FILE="${DEVCONTAINER_LOCAL_DNS_STATUS_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_STATUS_FILE:-/tmp/devcontainer-local-dns-cache.status}}"
readonly LOCAL_DNS_CACHE_STATUS_FILE
LOCAL_DNS_CACHE_SUMMARY_FILE="${DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.summary}}"
readonly LOCAL_DNS_CACHE_SUMMARY_FILE
LOCAL_DNS_CACHE_REPORT_FILE="${DEVCONTAINER_LOCAL_DNS_REPORT_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_REPORT_FILE:-/tmp/devcontainer-local-dns-cache.report}}"
readonly LOCAL_DNS_CACHE_REPORT_FILE
LOCAL_DNS_CACHE_METRICS_FILE="${DEVCONTAINER_LOCAL_DNS_METRICS_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_METRICS_FILE:-/tmp/devcontainer-local-dns-cache.metrics.tsv}}"
readonly LOCAL_DNS_CACHE_METRICS_FILE
LOCAL_COPILOT_PROXY_STATUS_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_FILE:-/tmp/devcontainer-copilot-proxy.status}"
readonly LOCAL_COPILOT_PROXY_STATUS_FILE
LOCAL_COPILOT_PROXY_SUMMARY_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_SUMMARY_FILE:-/tmp/devcontainer-copilot-proxy.summary}"
readonly LOCAL_COPILOT_PROXY_SUMMARY_FILE
LOCAL_COPILOT_PROXY_REPORT_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_REPORT_FILE:-/tmp/devcontainer-copilot-proxy.report}"
readonly LOCAL_COPILOT_PROXY_REPORT_FILE
LOCAL_COPILOT_PROXY_METRICS_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_METRICS_FILE:-/tmp/devcontainer-copilot-proxy.metrics.tsv}"
readonly LOCAL_COPILOT_PROXY_METRICS_FILE
LOCAL_COPILOT_PROXY_BENCHMARK_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_FILE:-/tmp/devcontainer-copilot-proxy.benchmark.tsv}"
readonly LOCAL_COPILOT_PROXY_BENCHMARK_FILE
LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE:-/tmp/devcontainer-copilot-proxy.benchmark.summary}"
readonly LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE
LOCAL_COPILOT_PROXY_COMPARISON_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_COMPARISON_FILE:-/tmp/devcontainer-copilot-proxy.comparison.tsv}"
readonly LOCAL_COPILOT_PROXY_COMPARISON_FILE
LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE:-/tmp/devcontainer-copilot-proxy.recommendation}"
readonly LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE
LOCAL_COPILOT_PROXY_ENV_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_ENV_FILE:-/tmp/devcontainer-copilot-proxy.env}"
readonly LOCAL_COPILOT_PROXY_ENV_FILE
COPILOT_ROUTE_ADVISOR_STATUS_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_STATUS_FILE:-/tmp/devcontainer-copilot-route-advisor.status}"
readonly COPILOT_ROUTE_ADVISOR_STATUS_FILE
COPILOT_ROUTE_ADVISOR_SUMMARY_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_SUMMARY_FILE:-/tmp/devcontainer-copilot-route-advisor.summary}"
readonly COPILOT_ROUTE_ADVISOR_SUMMARY_FILE
POST_START_REPORT_FILE="${DEVCONTAINER_POST_START_REPORT_FILE:-/tmp/devcontainer-post-start.report}"
readonly POST_START_REPORT_FILE
POST_START_SUMMARY_FILE="${DEVCONTAINER_POST_START_SUMMARY_FILE:-/tmp/devcontainer-post-start.summary}"
readonly POST_START_SUMMARY_FILE

MAKE_INFO_TIMEOUT_SECONDS="$(cfg_uint "${DEVCONTAINER_MAKE_TIMEOUT:-10}" 10 1 120)"
readonly MAKE_INFO_TIMEOUT_SECONDS
SUBSCRIPT_TIMEOUT_SECONDS="$(cfg_uint "${DEVCONTAINER_POST_START_SUBSCRIPT_TIMEOUT_SECONDS:-90}" 90 5 600)"
readonly SUBSCRIPT_TIMEOUT_SECONDS
PROBE_CONNECT_TIMEOUT="$(cfg_uint "${DEVCONTAINER_COPILOT_PROBE_CONNECT_TIMEOUT:-5}" 5 1 60)"
readonly PROBE_CONNECT_TIMEOUT
PROBE_MAX_TIME="$(cfg_uint "${DEVCONTAINER_COPILOT_PROBE_MAX_TIME:-10}" 10 2 120)"
readonly PROBE_MAX_TIME

ENABLE_SSHD_CHECK="$(cfg_bool "${DEVCONTAINER_ENABLE_SSHD_CHECK:-false}" false)"
readonly ENABLE_SSHD_CHECK
SSH_AUDIT_MODE="${DEVCONTAINER_SSH_AUDIT_MODE:-auto}"
readonly SSH_AUDIT_MODE

NSS_BASE_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"
readonly NSS_BASE_DIR
NSS_TARGET_USER_OVERRIDE="${DEVCONTAINER_NSS_TARGET_USER:-}"
readonly NSS_TARGET_USER_OVERRIDE
NSS_TARGET_HOME_OVERRIDE="${DEVCONTAINER_NSS_TARGET_HOME:-}"
readonly NSS_TARGET_HOME_OVERRIDE
NSS_WRAPPER_LIB_CANONICAL="${DEVCONTAINER_NSS_WRAPPER_LIB:-/usr/local/lib/devcontainer/libnss_wrapper.so}"
readonly NSS_WRAPPER_LIB_CANONICAL

ENABLE_DNS_FIX="$(cfg_bool "${DEVCONTAINER_ENABLE_DNS_FIX:-true}" true)"
readonly ENABLE_DNS_FIX
DNS_FIX_SERVERS="${DEVCONTAINER_DNS_FIX_SERVERS:-1.1.1.1 8.8.8.8}"
readonly DNS_FIX_SERVERS
DNS_FIX_OPTIONS="${DEVCONTAINER_DNS_FIX_OPTIONS:-timeout:1 attempts:2 rotate}"
readonly DNS_FIX_OPTIONS
DNS_FIX_ALLOW_LOOPBACK_SERVERS="$(cfg_bool "${DEVCONTAINER_DNS_FIX_ALLOW_LOOPBACK_SERVERS:-false}" false)"
readonly DNS_FIX_ALLOW_LOOPBACK_SERVERS
DNS_FIX_MAX_NAMESERVERS="$(cfg_uint "${DEVCONTAINER_DNS_FIX_MAX_NAMESERVERS:-3}" 3 1 3)"
readonly DNS_FIX_MAX_NAMESERVERS
DNS_BASELINE_ON_CACHE_OFF="$(cfg_bool "${DEVCONTAINER_POST_START_DNS_BASELINE_ON_CACHE_OFF:-true}" true)"
readonly DNS_BASELINE_ON_CACHE_OFF
DNS_BASELINE_ON_CACHE_FAILURE="$(cfg_bool "${DEVCONTAINER_POST_START_DNS_BASELINE_ON_CACHE_FAILURE:-true}" true)"
readonly DNS_BASELINE_ON_CACHE_FAILURE
ENABLE_LOCAL_DNS_CACHE="$(cfg_bool "${DEVCONTAINER_ENABLE_LOCAL_DNS_CACHE:-false}" false)"
readonly ENABLE_LOCAL_DNS_CACHE
LOCAL_DNS_CACHE_SCRIPT="${DEVCONTAINER_LOCAL_DNS_CACHE_SCRIPT:-${SCRIPT_DIR}/network/local-dns-cache.sh}"
readonly LOCAL_DNS_CACHE_SCRIPT
LOCAL_DNS_CACHE_POST_START_ACTION="${DEVCONTAINER_LOCAL_DNS_POST_START_ACTION:-start}"
case "${LOCAL_DNS_CACHE_POST_START_ACTION}" in
    start | status | health | doctor | stop) : ;;
    benchmark | restart) LOCAL_DNS_CACHE_POST_START_ACTION="health" ;;
    *) LOCAL_DNS_CACHE_POST_START_ACTION="start" ;;
esac
readonly LOCAL_DNS_CACHE_POST_START_ACTION

ENABLE_GITHUB_API_ROUTE_FIX="$(cfg_bool "${DEVCONTAINER_ENABLE_GITHUB_API_ROUTE_FIX:-true}" true)"
readonly ENABLE_GITHUB_API_ROUTE_FIX
GITHUB_API_HOST="${DEVCONTAINER_GITHUB_API_HOST:-api.github.com}"
readonly GITHUB_API_HOST
GITHUB_API_ROUTE_SCRIPT="${DEVCONTAINER_GITHUB_API_ROUTE_SCRIPT:-${SCRIPT_DIR}/network/github-api-route-fix.sh}"
readonly GITHUB_API_ROUTE_SCRIPT
GITHUB_API_ROUTE_POST_START_ACTION="${DEVCONTAINER_GITHUB_API_ROUTE_POST_START_ACTION:-start}"
case "${GITHUB_API_ROUTE_POST_START_ACTION}" in
    start | probe | status | doctor) : ;;
    benchmark | clear-cache) GITHUB_API_ROUTE_POST_START_ACTION="status" ;;
    *) GITHUB_API_ROUTE_POST_START_ACTION="start" ;;
esac
readonly GITHUB_API_ROUTE_POST_START_ACTION
SKIP_GITHUB_API_PROBES_AFTER_ROUTE_FIX="$(cfg_bool "${DEVCONTAINER_SKIP_GITHUB_API_PROBES_AFTER_ROUTE_FIX:-true}" true)"
readonly SKIP_GITHUB_API_PROBES_AFTER_ROUTE_FIX
SKIP_GITHUB_API_PROBES_AFTER_MANAGER_OK="$(cfg_bool "${DEVCONTAINER_SKIP_GITHUB_API_PROBES_AFTER_MANAGER_OK:-true}" true)"
readonly SKIP_GITHUB_API_PROBES_AFTER_MANAGER_OK

ENABLE_COPILOT_NETWORK_MANAGER="$(cfg_bool "${DEVCONTAINER_ENABLE_COPILOT_NETWORK_MANAGER:-false}" false)"
readonly ENABLE_COPILOT_NETWORK_MANAGER
COPILOT_NETWORK_MANAGER_SCRIPT="${DEVCONTAINER_COPILOT_NETWORK_MANAGER_SCRIPT:-${SCRIPT_DIR}/network/github-copilot-network-manager.sh}"
readonly COPILOT_NETWORK_MANAGER_SCRIPT
COPILOT_NETWORK_MANAGER_POST_START_ACTION="${DEVCONTAINER_COPILOT_NETWORK_MANAGER_POST_START_ACTION:-start}"
case "${COPILOT_NETWORK_MANAGER_POST_START_ACTION}" in
    start | probe | status | history | doctor | recommend) : ;;
    benchmark | compare-transports) COPILOT_NETWORK_MANAGER_POST_START_ACTION="recommend" ;;
    *) COPILOT_NETWORK_MANAGER_POST_START_ACTION="start" ;;
esac
readonly COPILOT_NETWORK_MANAGER_POST_START_ACTION
POST_START_APPLY_TRANSPORT_RECOMMENDATION="$(cfg_bool "${DEVCONTAINER_POST_START_APPLY_TRANSPORT_RECOMMENDATION:-false}" false)"
readonly POST_START_APPLY_TRANSPORT_RECOMMENDATION
POST_START_RECOMMENDATION_MAX_AGE_SECONDS="$(cfg_uint "${DEVCONTAINER_POST_START_RECOMMENDATION_MAX_AGE_SECONDS:-86400}" 86400 60 604800)"
readonly POST_START_RECOMMENDATION_MAX_AGE_SECONDS
BOOT_TRANSPORT_PROFILE="${DEVCONTAINER_COPILOT_TRANSPORT_PROFILE:-${DEVCONTAINER_COPILOT_MANAGER_TRANSPORT_PROFILE:-auto}}"
case "${BOOT_TRANSPORT_PROFILE}" in
    auto | direct | proxy-local | proxy-env) : ;;
    local) BOOT_TRANSPORT_PROFILE="proxy-local" ;;
    proxy-aware) BOOT_TRANSPORT_PROFILE="proxy-env" ;;
    *) BOOT_TRANSPORT_PROFILE="auto" ;;
esac
readonly BOOT_TRANSPORT_PROFILE
ENABLE_COPILOT_ENDPOINT_PROBES="$(cfg_bool "${DEVCONTAINER_ENABLE_COPILOT_ENDPOINT_PROBES:-true}" true)"
readonly ENABLE_COPILOT_ENDPOINT_PROBES
COPILOT_PROBE_IP_FAMILY="${DEVCONTAINER_COPILOT_PROBE_IP_FAMILY:-4}"
case "${COPILOT_PROBE_IP_FAMILY}" in
    4 | 6 | auto) : ;;
    *) COPILOT_PROBE_IP_FAMILY="4" ;;
esac
readonly COPILOT_PROBE_IP_FAMILY

ENABLE_LOCAL_COPILOT_PROXY="$(cfg_bool "${DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY:-false}" false)"
readonly ENABLE_LOCAL_COPILOT_PROXY
LOCAL_COPILOT_PROXY_SCRIPT="${DEVCONTAINER_LOCAL_COPILOT_PROXY_SCRIPT:-${SCRIPT_DIR}/network/local-copilot-proxy.sh}"
readonly LOCAL_COPILOT_PROXY_SCRIPT
OBSERVE_LOCAL_COPILOT_PROXY_STATUS="$(cfg_bool "${DEVCONTAINER_POST_START_OBSERVE_LOCAL_PROXY_STATUS:-true}" true)"
readonly OBSERVE_LOCAL_COPILOT_PROXY_STATUS
if [[ "${ENABLE_LOCAL_COPILOT_PROXY}" == "true" ]]; then
    LOCAL_COPILOT_PROXY_POST_START_ACTION="${DEVCONTAINER_LOCAL_COPILOT_PROXY_POST_START_ACTION:-start}"
else
    LOCAL_COPILOT_PROXY_POST_START_ACTION="${DEVCONTAINER_LOCAL_COPILOT_PROXY_POST_START_ACTION:-status}"
fi
case "${LOCAL_COPILOT_PROXY_POST_START_ACTION}" in
    start | stop | status | restart | probe | env) : ;;
    *) LOCAL_COPILOT_PROXY_POST_START_ACTION="status" ;;
esac
readonly LOCAL_COPILOT_PROXY_POST_START_ACTION
LEGACY_PROBES_AFTER_MANAGER="$(cfg_bool "${DEVCONTAINER_POST_START_LEGACY_PROBES_AFTER_MANAGER:-false}" false)"
readonly LEGACY_PROBES_AFTER_MANAGER
ALLOW_SOURCE_LOCAL_PROXY_ENV="$(cfg_bool "${DEVCONTAINER_POST_START_SOURCE_LOCAL_PROXY_ENV:-false}" false)"
readonly ALLOW_SOURCE_LOCAL_PROXY_ENV

# Network smoke probes. These are not auth checks. 4xx can be acceptable for
# unauthenticated service endpoints; 000/TLS failure is the primary red flag.
ENABLE_EXTENDED_COPILOT_PROBES="$(cfg_bool "${DEVCONTAINER_POST_START_EXTENDED_COPILOT_PROBES:-false}" false)"
readonly ENABLE_EXTENDED_COPILOT_PROBES
COPILOT_ENDPOINT_REGISTRY_FILE="${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE:-${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY:-${SCRIPT_DIR}/../network/endpoints.github-copilot.tsv}}"
readonly COPILOT_ENDPOINT_REGISTRY_FILE
USE_COPILOT_ENDPOINT_REGISTRY="$(cfg_bool "${DEVCONTAINER_COPILOT_USE_ENDPOINT_REGISTRY:-true}" true)"
readonly USE_COPILOT_ENDPOINT_REGISTRY
COPILOT_ENDPOINT_REGISTRY_MAX_ROWS="$(cfg_uint "${DEVCONTAINER_POST_START_ENDPOINT_REGISTRY_MAX_ROWS:-32}" 32 1 128)"
readonly COPILOT_ENDPOINT_REGISTRY_MAX_ROWS
DEFAULT_COPILOT_PROBE_ENDPOINTS="https://copilot-proxy.githubusercontent.com https://api.github.com https://api.github.com/rate_limit https://api.github.com/user https://api.github.com/copilot_internal/v2/token https://default.exp-tas.com https://api.githubcopilot.com https://api.individual.githubcopilot.com https://proxy.individual.githubcopilot.com"
EXTENDED_COPILOT_PROBE_ENDPOINTS="https://github.com/login https://github.com/copilot https://origin-tracker.githubusercontent.com https://copilot-telemetry.githubusercontent.com/telemetry https://collector.github.com https://api.business.githubcopilot.com https://proxy.business.githubcopilot.com https://api.enterprise.githubcopilot.com https://proxy.enterprise.githubcopilot.com https://copilot-reports.github.com https://uploads.github.com/copilot/chat/attachments/"
REGISTRY_COPILOT_PROBE_ENDPOINTS=""
if [[ "${USE_COPILOT_ENDPOINT_REGISTRY}" == "true" && -r "${COPILOT_ENDPOINT_REGISTRY_FILE}" ]]; then
    REGISTRY_COPILOT_PROBE_ENDPOINTS="$(awk -F'	' -v max="${COPILOT_ENDPOINT_REGISTRY_MAX_ROWS}" '
        /^[[:space:]]*#/ { next }
        NF == 0 { next }
        {
            for (i=1; i<=NF; i++) {
                if ($i ~ /^https:\/\//) {
                    print $i
                    emitted++
                    break
                }
            }
            if (emitted >= max) exit
        }
    ' "${COPILOT_ENDPOINT_REGISTRY_FILE}" 2> /dev/null | tr '\n' ' ')"
fi
if [[ -n "${DEVCONTAINER_COPILOT_PROBE_ENDPOINTS:-}" ]]; then
    COPILOT_PROBE_ENDPOINTS="${DEVCONTAINER_COPILOT_PROBE_ENDPOINTS}"
elif [[ -n "${REGISTRY_COPILOT_PROBE_ENDPOINTS}" ]]; then
    COPILOT_PROBE_ENDPOINTS="${REGISTRY_COPILOT_PROBE_ENDPOINTS}"
elif [[ "${ENABLE_EXTENDED_COPILOT_PROBES}" == "true" ]]; then
    COPILOT_PROBE_ENDPOINTS="${DEFAULT_COPILOT_PROBE_ENDPOINTS} ${EXTENDED_COPILOT_PROBE_ENDPOINTS}"
else
    COPILOT_PROBE_ENDPOINTS="${DEFAULT_COPILOT_PROBE_ENDPOINTS}"
fi
readonly DEFAULT_COPILOT_PROBE_ENDPOINTS EXTENDED_COPILOT_PROBE_ENDPOINTS REGISTRY_COPILOT_PROBE_ENDPOINTS COPILOT_PROBE_ENDPOINTS

# -----------------------------------------------------------------------------
# Logging / status helpers
# -----------------------------------------------------------------------------
log_info() { printf '%s\n' "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { printf '%s\n' "⚠️  [${SCRIPT_NAME}] $*"; }
log_ok() { printf '%s\n' "✅ [${SCRIPT_NAME}] $*"; }
log_debug() {
    if [[ "${DEVCONTAINER_VERBOSE_NETWORK:-false}" == "true" ]]; then
        printf '%s\n' "🔎 [${SCRIPT_NAME}] $*" >&2
    fi
}

ts() { date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date; }

sanitize_oneline() {
    printf '%s' "${1:-}" | tr '\n\r\t' '   '
}
redact_url_credentials() {
    local value
    value="${1:-}"
    printf '%s' "${value}" | sed -E 's#(https?://)[^/@:]+(:[^/@]*)?@#\1***:***@#g; s#(socks5h?://)[^/@:]+(:[^/@]*)?@#\1***:***@#g' 2> /dev/null || printf '%s' "${value}"
}

ensure_parent_dir() {
    local path dir
    path="${1:-/tmp/unknown}"
    dir="$(dirname "${path}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${dir}" 2> /dev/null || true
}

log_error_detail() {
    ensure_parent_dir "${HEALTH_ERROR_LOG}"
    {
        printf '[%s] %s\n' "$(ts)" "$*"
    } >> "${HEALTH_ERROR_LOG}" 2> /dev/null || true
}

write_atomic_file() {
    local path mode dir tmp
    path="${1:-}"
    mode="${2:-0644}"
    [[ -n "${path}" ]] || return 1
    ensure_parent_dir "${path}"
    dir="$(dirname "${path}" 2> /dev/null || printf '/tmp')"
    tmp="$(mktemp "${dir%/}/.${SCRIPT_NAME}.XXXXXX" 2> /dev/null || true)"
    [[ -n "${tmp}" ]] || return 1
    cat > "${tmp}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
    chmod "${mode}" "${tmp}" 2> /dev/null || true
    mv -f "${tmp}" "${path}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
}

write_status_file() {
    local path value
    path="${1:-}"
    value="${2:-unknown}"
    printf '%s\n' "${value}" | write_atomic_file "${path}" 0644 || {
        ensure_parent_dir "${path}"
        printf '%s\n' "${value}" > "${path}" 2> /dev/null || true
    }
}

append_post_start_report() {
    ensure_parent_dir "${POST_START_REPORT_FILE}"
    printf '%s\n' "$*" >> "${POST_START_REPORT_FILE}" 2> /dev/null || true
}

write_post_start_report_header() {
    ensure_parent_dir "${POST_START_REPORT_FILE}"
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'project_root=%s\n' "$(sanitize_oneline "${PROJECT_ROOT}")"
        printf 'enable_local_dns_cache=%s\n' "${ENABLE_LOCAL_DNS_CACHE}"
        printf 'enable_local_copilot_proxy=%s\n' "${ENABLE_LOCAL_COPILOT_PROXY}"
        printf 'enable_copilot_network_manager=%s\n' "${ENABLE_COPILOT_NETWORK_MANAGER}"
        printf 'enable_github_api_route_fix=%s\n' "${ENABLE_GITHUB_API_ROUTE_FIX}"
        printf 'route_status_file=%s\n' "${GITHUB_ROUTE_STATUS_FILE}"
        printf 'route_summary_file=%s\n' "${GITHUB_ROUTE_SUMMARY_FILE}"
        printf 'route_metrics_file=%s\n' "${GITHUB_ROUTE_METRICS_FILE}"
        printf 'route_benchmark_summary_file=%s\n' "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}"
        printf 'route_recommendation_file=%s\n' "${GITHUB_ROUTE_RECOMMENDATION_FILE}"
        printf 'local_dns_status_file=%s\n' "${LOCAL_DNS_CACHE_STATUS_FILE}"
        printf 'local_dns_summary_file=%s\n' "${LOCAL_DNS_CACHE_SUMMARY_FILE}"
        printf 'local_dns_metrics_file=%s\n' "${LOCAL_DNS_CACHE_METRICS_FILE}"
        printf 'copilot_network_diagnosis_file=%s\n' "${COPILOT_NETWORK_DIAGNOSIS_FILE}"
        printf 'copilot_network_recommendation_file=%s\n' "${COPILOT_NETWORK_RECOMMENDATION_FILE}"
        printf 'copilot_network_recommendation_json_file=%s\n' "${COPILOT_NETWORK_RECOMMENDATION_JSON_FILE}"
        printf 'dns_fix_max_nameservers=%s\n' "${DNS_FIX_MAX_NAMESERVERS}"
        printf 'local_proxy_post_start_action=%s\n' "${LOCAL_COPILOT_PROXY_POST_START_ACTION}"
        printf 'local_proxy_benchmark_summary_file=%s\n' "${LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE}"
        printf 'local_proxy_comparison_file=%s\n' "${LOCAL_COPILOT_PROXY_COMPARISON_FILE}"
        printf 'local_proxy_recommendation_file=%s\n' "${LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE}"
        printf 'copilot_network_manager_post_start_action=%s\n' "${COPILOT_NETWORK_MANAGER_POST_START_ACTION}"
        printf 'github_api_route_post_start_action=%s\n' "${GITHUB_API_ROUTE_POST_START_ACTION}"
        printf 'local_dns_post_start_action=%s\n' "${LOCAL_DNS_CACHE_POST_START_ACTION}"
        printf 'copilot_endpoint_registry_file=%s\n' "${COPILOT_ENDPOINT_REGISTRY_FILE}"
        printf 'copilot_endpoint_registry_used=%s\n' "${USE_COPILOT_ENDPOINT_REGISTRY}"
        printf 'boot_transport_profile=%s\n' "${BOOT_TRANSPORT_PROFILE}"
        printf 'apply_transport_recommendation=%s\n' "${POST_START_APPLY_TRANSPORT_RECOMMENDATION}"
        printf 'post_start_summary=%s\n' "${POST_START_SUMMARY_FILE}"
        printf '\n'
    } > "${POST_START_REPORT_FILE}" 2> /dev/null || true
}
read_status_value() {
    local path value
    path="${1:-}"
    value="unknown"
    if [[ -n "${path}" && -r "${path}" ]]; then
        value="$(awk 'NR==1{print $1; exit}' "${path}" 2> /dev/null || printf unknown)"
    fi
    [[ -n "${value}" ]] || value="unknown"
    printf '%s\n' "${value}"
}

kv_value_from_file() {
    local path key
    path="${1:-}"
    key="${2:-}"
    [[ -n "${path}" && -n "${key}" && -r "${path}" ]] || return 0
    awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}' "${path}" 2> /dev/null
}

kv_value_any() {
    local path key value
    path="${1:-}"
    shift || true
    [[ -n "${path}" && -r "${path}" ]] || return 0
    for key in "$@"; do
        [[ -n "${key}" ]] || continue
        value="$(kv_value_from_file "${path}" "${key}")"
        if [[ -n "${value}" ]]; then
            printf '%s' "${value}"
            return 0
        fi
    done
    return 0
}

recommendation_is_fresh() {
    local path max_age now generated_epoch age
    path="${1:-}"
    max_age="${2:-${POST_START_RECOMMENDATION_MAX_AGE_SECONDS}}"
    [[ -r "${path}" ]] || return 1
    generated_epoch="$(kv_value_any "${path}" generated_epoch timestamp_epoch created_epoch)"
    [[ "${generated_epoch}" =~ ^[0-9]+$ ]] || return 1
    now="$(date '+%s' 2> /dev/null || printf '0')"
    [[ "${now}" =~ ^[0-9]+$ && "${now}" -gt 0 ]] || return 1
    age=$((now - generated_epoch))
    ((age >= 0 && age <= max_age))
}

manager_recommended_transport_for_boot() {
    local action transport confidence
    if [[ "${POST_START_APPLY_TRANSPORT_RECOMMENDATION}" != "true" ]]; then
        printf '%s' "${BOOT_TRANSPORT_PROFILE}"
        return 0
    fi
    if ! recommendation_is_fresh "${COPILOT_NETWORK_RECOMMENDATION_FILE}" "${POST_START_RECOMMENDATION_MAX_AGE_SECONDS}"; then
        printf '%s' "${BOOT_TRANSPORT_PROFILE}"
        return 0
    fi
    action="$(kv_value_any "${COPILOT_NETWORK_RECOMMENDATION_FILE}" recommended_action action)"
    transport="$(kv_value_any "${COPILOT_NETWORK_RECOMMENDATION_FILE}" recommended_transport transport)"
    confidence="$(kv_value_any "${COPILOT_NETWORK_RECOMMENDATION_FILE}" confidence)"
    case "${action}:${transport}:${confidence}" in
        prefer-proxy-opt-in:proxy-local:high | prefer-proxy-opt-in:proxy-local:medium)
            if [[ "${ENABLE_LOCAL_COPILOT_PROXY}" == "true" ]]; then
                printf 'proxy-local'
                return 0
            fi
            ;;
        keep-direct:direct:* | *:direct:*)
            printf 'direct'
            return 0
            ;;
    esac
    printf '%s' "${BOOT_TRANSPORT_PROFILE}"
}

route_fix_proven_ok() {
    local route_status route_summary_status manager_route_status manager_github_plane
    route_status="$(read_status_value "${GITHUB_ROUTE_STATUS_FILE}")"
    route_summary_status="$(kv_value_from_file "${GITHUB_ROUTE_SUMMARY_FILE}" status)"
    manager_route_status="$(kv_value_from_file "${COPILOT_NETWORK_SUMMARY_FILE}" route_status)"
    manager_github_plane="$(kv_value_from_file "${COPILOT_NETWORK_SUMMARY_FILE}" plane_github_api_status)"

    if [[ "${route_summary_status}" == "ok" || "${route_status}" == "ok" || "${manager_route_status}" == "ok" ]]; then
        printf 'true'
        return 0
    fi
    if [[ "${SKIP_GITHUB_API_PROBES_AFTER_MANAGER_OK}" == "true" && "${manager_github_plane}" == "ok" ]]; then
        printf 'true'
        return 0
    fi
    printf 'false'
}

local_dns_cache_proven_ok() {
    local dns_status status_stale process_status port_status resolv_health nameservers
    dns_status="$(read_status_value "${LOCAL_DNS_CACHE_STATUS_FILE}")"
    status_stale="$(kv_value_from_file "${LOCAL_DNS_CACHE_SUMMARY_FILE}" status_stale)"
    process_status="$(kv_value_from_file "${LOCAL_DNS_CACHE_SUMMARY_FILE}" dnsmasq_process_status)"
    port_status="$(kv_value_from_file "${LOCAL_DNS_CACHE_SUMMARY_FILE}" dnsmasq_port_status)"
    resolv_health="$(kv_value_from_file "${LOCAL_DNS_CACHE_SUMMARY_FILE}" resolv_conf_health)"
    nameservers="$(kv_value_from_file "${LOCAL_DNS_CACHE_SUMMARY_FILE}" resolv_conf_nameservers)"

    [[ "${dns_status}" == "ok" ]] || return 1
    [[ "${status_stale}" != "true" ]] || return 1
    case "${process_status}" in
        running*) : ;;
        *) return 1 ;;
    esac
    case "${port_status}" in
        bound-managed | listening-managed | running-managed | ok | unknown) : ;;
        *) return 1 ;;
    esac
    case "${resolv_health}:${nameservers}" in
        *points-to-cache*:* | *ok*:* | *:127.0.0.1* | *:::1*) return 0 ;;
        *) return 1 ;;
    esac
}

local_dns_cache_is_off_status() {
    local dns_status
    dns_status="$(read_status_value "${LOCAL_DNS_CACHE_STATUS_FILE}")"
    case "${dns_status}" in
        off | disabled | skipped | stopped) return 0 ;;
        *) return 1 ;;
    esac
}

append_summary_snapshot_to_report() {
    local label path
    label="${1:-summary}"
    path="${2:-}"
    [[ -n "${path}" && -r "${path}" ]] || {
        append_post_start_report "${label}=missing path=${path:-unknown}"
        return 0
    }
    append_post_start_report "${label}_begin path=${path}"
    sed 's/[[:cntrl:]]//g; s/^/summary: /' "${path}" >> "${POST_START_REPORT_FILE}" 2> /dev/null || true
    append_post_start_report "${label}_end"
}

write_post_start_summary() {
    local health network diagnostics dns_status route_status manager_status proxy_status advisor_status
    local route_decision manager_recommendations manager_rec_action manager_rec_transport manager_rec_confidence manager_rec_reason
    local proxy_rec_action proxy_rec_confidence route_rec_action boot_transport registry_status registry_rows registry_bad_rows
    health="${1:-unknown}"
    network="${2:-unknown}"
    diagnostics="${3:-unknown}"
    dns_status="$(read_status_value "${LOCAL_DNS_CACHE_STATUS_FILE}")"
    route_status="$(kv_value_from_file "${GITHUB_ROUTE_SUMMARY_FILE}" status)"
    [[ -n "${route_status}" ]] || route_status="$(read_status_value "${GITHUB_ROUTE_STATUS_FILE}")"
    manager_status="$(kv_value_from_file "${COPILOT_NETWORK_SUMMARY_FILE}" status)"
    [[ -n "${manager_status}" ]] || manager_status="$(read_status_value "${COPILOT_NETWORK_STATUS_FILE}")"
    proxy_status="$(kv_value_from_file "${LOCAL_COPILOT_PROXY_SUMMARY_FILE}" status)"
    [[ -n "${proxy_status}" ]] || proxy_status="$(read_status_value "${LOCAL_COPILOT_PROXY_STATUS_FILE}")"
    advisor_status="$(kv_value_from_file "${COPILOT_ROUTE_ADVISOR_SUMMARY_FILE}" status)"
    [[ -n "${advisor_status}" ]] || advisor_status="$(read_status_value "${COPILOT_ROUTE_ADVISOR_STATUS_FILE}")"
    route_decision="$(sanitize_oneline "$(kv_value_from_file "${GITHUB_ROUTE_SUMMARY_FILE}" decision_reason)")"
    manager_recommendations="$(sanitize_oneline "$(kv_value_from_file "${COPILOT_NETWORK_SUMMARY_FILE}" recommendations)")"
    manager_rec_action="$(sanitize_oneline "$(kv_value_any "${COPILOT_NETWORK_RECOMMENDATION_FILE}" recommended_action action)")"
    manager_rec_transport="$(sanitize_oneline "$(kv_value_any "${COPILOT_NETWORK_RECOMMENDATION_FILE}" recommended_transport transport)")"
    manager_rec_confidence="$(sanitize_oneline "$(kv_value_any "${COPILOT_NETWORK_RECOMMENDATION_FILE}" confidence)")"
    manager_rec_reason="$(sanitize_oneline "$(kv_value_any "${COPILOT_NETWORK_RECOMMENDATION_FILE}" reason)")"
    proxy_rec_action="$(sanitize_oneline "$(kv_value_any "${LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE}" recommended_action action)")"
    proxy_rec_confidence="$(sanitize_oneline "$(kv_value_any "${LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE}" confidence)")"
    route_rec_action="$(sanitize_oneline "$(kv_value_any "${GITHUB_ROUTE_RECOMMENDATION_FILE}" recommended_action recommendation action decision)")"
    boot_transport="$(manager_recommended_transport_for_boot)"
    registry_status="missing"
    registry_rows="0"
    registry_bad_rows="0"
    if [[ -r "${COPILOT_ENDPOINT_REGISTRY_FILE}" ]]; then
        registry_status="ok"
        registry_rows="$(awk -F'\t' 'BEGIN{c=0} /^[[:space:]]*#/ || NF==0 {next} {c++} END{print c+0}' "${COPILOT_ENDPOINT_REGISTRY_FILE}" 2> /dev/null || printf '0')"
        registry_bad_rows="$(awk -F'\t' 'BEGIN{bad=0} /^[[:space:]]*#/ || NF==0 {next} NF != 5 {bad++} END{print bad+0}' "${COPILOT_ENDPOINT_REGISTRY_FILE}" 2> /dev/null || printf '0')"
        if [[ "${registry_bad_rows}" =~ ^[0-9]+$ && "${registry_bad_rows}" -gt 0 ]]; then
            registry_status="degraded"
        fi
    fi

    {
        printf 'status=%s\n' "${health}"
        printf 'network_status=%s\n' "${network}"
        printf 'diagnostics_status=%s\n' "${diagnostics}"
        printf 'script_version=%s\n' "${SCRIPT_VERSION}"
        printf 'project_root=%s\n' "$(sanitize_oneline "${PROJECT_ROOT}")"
        printf 'local_dns_cache_status=%s\n' "${dns_status}"
        printf 'local_dns_cache_summary=%s\n' "${LOCAL_DNS_CACHE_SUMMARY_FILE}"
        printf 'local_dns_cache_metrics=%s\n' "${LOCAL_DNS_CACHE_METRICS_FILE}"
        printf 'local_dns_cache_resolv_conf_health=%s\n' "$(kv_value_from_file "${LOCAL_DNS_CACHE_SUMMARY_FILE}" resolv_conf_health)"
        printf 'local_dns_cache_status_stale=%s\n' "$(kv_value_from_file "${LOCAL_DNS_CACHE_SUMMARY_FILE}" status_stale)"
        printf 'local_dns_cache_dnsmasq_process_status=%s\n' "$(kv_value_from_file "${LOCAL_DNS_CACHE_SUMMARY_FILE}" dnsmasq_process_status)"
        printf 'local_dns_cache_dnsmasq_port_status=%s\n' "$(kv_value_from_file "${LOCAL_DNS_CACHE_SUMMARY_FILE}" dnsmasq_port_status)"
        printf 'local_dns_cache_selected_upstreams=%s\n' "$(sanitize_oneline "$(kv_value_from_file "${LOCAL_DNS_CACHE_SUMMARY_FILE}" selected_upstreams)")"
        printf 'github_route_status=%s\n' "${route_status:-unknown}"
        printf 'github_route_summary=%s\n' "${GITHUB_ROUTE_SUMMARY_FILE}"
        printf 'github_route_metrics=%s\n' "${GITHUB_ROUTE_METRICS_FILE}"
        printf 'github_route_benchmark=%s\n' "${GITHUB_ROUTE_BENCHMARK_FILE}"
        printf 'github_route_benchmark_summary=%s\n' "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}"
        printf 'github_route_recommendation=%s\n' "${GITHUB_ROUTE_RECOMMENDATION_FILE}"
        printf 'github_route_recommendation_action=%s\n' "${route_rec_action:-unknown}"
        printf 'github_route_current_ip=%s\n' "$(kv_value_any "${GITHUB_ROUTE_RECOMMENDATION_FILE}" current_ip)"
        printf 'github_route_best_candidate_ip=%s\n' "$(kv_value_any "${GITHUB_ROUTE_RECOMMENDATION_FILE}" best_candidate_ip)"
        printf 'github_route_current_p95_ms=%s\n' "$(kv_value_any "${GITHUB_ROUTE_RECOMMENDATION_FILE}" current_p95_ms)"
        printf 'github_route_best_candidate_p95_ms=%s\n' "$(kv_value_any "${GITHUB_ROUTE_RECOMMENDATION_FILE}" best_candidate_p95_ms best_p95_ms)"
        printf 'github_route_selected_ip=%s\n' "$(kv_value_from_file "${GITHUB_ROUTE_SUMMARY_FILE}" selected_ip)"
        printf 'github_route_decision=%s\n' "${route_decision:-unknown}"
        printf 'copilot_network_status=%s\n' "${manager_status}"
        printf 'copilot_network_summary=%s\n' "${COPILOT_NETWORK_SUMMARY_FILE}"
        printf 'copilot_network_diagnosis=%s\n' "${COPILOT_NETWORK_DIAGNOSIS_FILE}"
        printf 'copilot_network_recommendation=%s\n' "${COPILOT_NETWORK_RECOMMENDATION_FILE}"
        printf 'copilot_network_recommendation_json=%s\n' "${COPILOT_NETWORK_RECOMMENDATION_JSON_FILE}"
        printf 'copilot_network_plane_overall=%s\n' "$(kv_value_from_file "${COPILOT_NETWORK_SUMMARY_FILE}" plane_overall_status)"
        printf 'copilot_network_recommendations=%s\n' "${manager_recommendations:-observe}"
        printf 'copilot_network_recommendation_action=%s\n' "${manager_rec_action:-unknown}"
        printf 'copilot_network_recommended_transport=%s\n' "${manager_rec_transport:-unknown}"
        printf 'copilot_network_recommendation_confidence=%s\n' "${manager_rec_confidence:-unknown}"
        printf 'copilot_network_recommendation_reason=%s\n' "${manager_rec_reason:-unknown}"
        printf 'copilot_network_route_artifact_state=%s\n' "$(kv_value_from_file "${COPILOT_NETWORK_RECOMMENDATION_FILE}" route_artifact_state)"
        printf 'copilot_network_proxy_artifact_state=%s\n' "$(kv_value_from_file "${COPILOT_NETWORK_RECOMMENDATION_FILE}" proxy_artifact_state)"
        printf 'copilot_network_github_api_soft_degraded_count=%s\n' "$(kv_value_from_file "${COPILOT_NETWORK_SUMMARY_FILE}" github_api_soft_degraded_count)"
        printf 'copilot_network_overall_soft_degraded_count=%s\n' "$(kv_value_from_file "${COPILOT_NETWORK_SUMMARY_FILE}" overall_soft_degraded_count)"
        printf 'endpoint_registry_file=%s\n' "${COPILOT_ENDPOINT_REGISTRY_FILE}"
        printf 'endpoint_registry_status=%s\n' "${registry_status}"
        printf 'endpoint_registry_rows=%s\n' "${registry_rows}"
        printf 'endpoint_registry_bad_rows=%s\n' "${registry_bad_rows}"
        printf 'boot_transport_profile=%s\n' "${boot_transport}"
        printf 'apply_transport_recommendation=%s\n' "${POST_START_APPLY_TRANSPORT_RECOMMENDATION}"
        printf 'copilot_route_advisor_status=%s\n' "${advisor_status}"
        printf 'copilot_route_advisor_summary=%s\n' "${COPILOT_ROUTE_ADVISOR_SUMMARY_FILE}"
        printf 'local_copilot_proxy_status=%s\n' "${proxy_status}"
        printf 'local_copilot_proxy_summary=%s\n' "${LOCAL_COPILOT_PROXY_SUMMARY_FILE}"
        printf 'local_copilot_proxy_benchmark=%s\n' "${LOCAL_COPILOT_PROXY_BENCHMARK_FILE}"
        printf 'local_copilot_proxy_benchmark_summary=%s\n' "${LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE}"
        printf 'local_copilot_proxy_comparison=%s\n' "${LOCAL_COPILOT_PROXY_COMPARISON_FILE}"
        printf 'local_copilot_proxy_recommendation=%s\n' "${LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE}"
        printf 'local_copilot_proxy_recommendation_action=%s\n' "${proxy_rec_action:-unknown}"
        printf 'local_copilot_proxy_recommendation_confidence=%s\n' "${proxy_rec_confidence:-unknown}"
        printf 'post_start_report=%s\n' "${POST_START_REPORT_FILE}"
        printf 'health_error_log=%s\n' "${HEALTH_ERROR_LOG}"
        printf 'completed_at=%s\n' "$(ts)"
    } | write_atomic_file "${POST_START_SUMMARY_FILE}" 0644 || true
}
# -----------------------------------------------------------------------------
# Utility helpers
# -----------------------------------------------------------------------------
has_cmd() { command -v "$1" > /dev/null 2>&1; }

safe_sudo() {
    # Non-interactive by design. A start hook must never hang on a password prompt.
    if [[ "$(id -u 2> /dev/null || echo 1)" == "0" ]]; then
        "$@"
        return $?
    fi

    if has_cmd sudo; then
        sudo -n "$@"
        return $?
    fi

    return 127
}

run_with_timeout() {
    local seconds
    seconds="$1"
    shift

    if has_cmd timeout; then
        timeout "${seconds}" "$@"
        return $?
    fi

    "$@"
    return $?
}

make_temp_file() {
    local prefix dir tmp
    prefix="${1:-tmp}"
    dir="${2:-/tmp}"
    tmp=""

    mkdir -p "${dir}" 2> /dev/null || dir="/tmp"
    tmp="$(mktemp "${dir%/}/${prefix}.XXXXXX" 2> /dev/null || true)"
    if [[ -n "${tmp}" ]]; then
        printf '%s\n' "${tmp}"
        return 0
    fi

    tmp="$(mktemp "/tmp/${prefix}.XXXXXX" 2> /dev/null || true)"
    [[ -n "${tmp}" ]] && printf '%s\n' "${tmp}"
}

extract_field() {
    local key line
    key="$1"
    line="$2"

    printf '%s' "${line}" | tr '|' '\n' | awk -F= -v k="${key}" '
        $1 == k {
            sub($1"=", "")
            print
            exit
        }
    '
}

float_ms() {
    local value
    value="${1:-0}"
    value="${value/,/.}"
    LC_ALL=C awk -v s="${value}" 'BEGIN { if (s == "") s=0; printf "%d", s*1000 }' 2> /dev/null
}

is_ipv4() {
    awk -v ip="$1" 'BEGIN {
        n=split(ip,a,"."); if (n != 4) exit 1;
        for (i=1;i<=4;i++) {
            if (a[i] !~ /^[0-9]+$/) exit 1;
            if (a[i] < 0 || a[i] > 255) exit 1;
        }
        exit 0;
    }' 2> /dev/null
}

is_ipv6_literal() {
    [[ "${1:-}" == *:* ]] || return 1
    if has_cmd python3; then
        python3 - "$1" << 'PY' > /dev/null 2>&1
import ipaddress, sys
try:
    ip = ipaddress.IPv6Address(sys.argv[1])
    if ip.ipv4_mapped is not None:
        sys.exit(1)
except Exception:
    sys.exit(1)
PY
        return $?
    fi
    [[ "$1" =~ ^[0-9A-Fa-f:]+$ ]]
}

is_loopback_literal() {
    case "${1:-}" in
        127.* | ::1) return 0 ;;
        *) return 1 ;;
    esac
}

is_dns_nameserver_literal() {
    is_ipv4 "$1" || is_ipv6_literal "$1"
}

is_allowed_dns_fix_nameserver() {
    is_dns_nameserver_literal "$1" || return 1
    if is_loopback_literal "$1" && [[ "${DNS_FIX_ALLOW_LOOPBACK_SERVERS}" != "true" ]]; then
        return 1
    fi
    return 0
}

is_safe_hostname() {
    local host label old_ifs
    host="${1:-}"
    [[ ${#host} -ge 1 && ${#host} -le 253 ]] || return 1
    [[ "${host}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] || return 1
    [[ "${host}" != *..* ]] || return 1
    [[ "${host}" == *.* ]] || return 1
    old_ifs="${IFS}"
    IFS='.'
    for label in ${host}; do
        [[ ${#label} -ge 1 && ${#label} -le 63 ]] || {
            IFS="${old_ifs}"
            return 1
        }
        [[ "${label}" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || {
            IFS="${old_ifs}"
            return 1
        }
    done
    IFS="${old_ifs}"
    return 0
}

lowercase() {
    printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'
}

url_host() {
    local url no_proto hostport host
    url="${1:-}"
    no_proto="${url#*://}"
    hostport="${no_proto%%/*}"
    host="${hostport%%:*}"
    printf '%s' "${host}"
}

is_allowed_copilot_probe_host() {
    local host
    host="$(lowercase "${1:-}")"
    case "${host}" in
        github.com | api.github.com | uploads.github.com | user-images.githubusercontent.com | collector.github.com | default.exp-tas.com | copilot-proxy.githubusercontent.com | origin-tracker.githubusercontent.com | copilot-telemetry.githubusercontent.com | copilot-reports.github.com)
            return 0
            ;;
        *.githubcopilot.com | copilot-reports-*.b01.azurefd.net | usagereports*.blob.core.windows.net)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_safe_copilot_probe_url() {
    local url host hostport no_proto
    url="${1:-}"
    [[ "${url}" == https://* ]] || return 1
    [[ "${url}" != *[[:space:]]* && "${url}" != *\* ]] || return 1
    no_proto="${url#https://}"
    hostport="${no_proto%%/*}"
    [[ -n "${hostport}" && "${hostport}" != *"@"* ]] || return 1
    [[ "${hostport}" != *:* ]] || return 1
    host="$(url_host "${url}")"
    is_safe_hostname "${host}" || return 1
    is_allowed_copilot_probe_host "${host}" || return 1
    return 0
}

sanitize_resolv_options() {
    local token clean n
    clean=""
    for token in ${DNS_FIX_OPTIONS}; do
        case "${token}" in
            timeout:[0-9]*)
                n="${token#timeout:}"
                if [[ "${n}" =~ ^[0-9]+$ ]]; then
                    ((n < 1)) && n=1
                    ((n > 30)) && n=30
                    clean="${clean} timeout:${n}"
                fi
                ;;
            attempts:[0-9]*)
                n="${token#attempts:}"
                if [[ "${n}" =~ ^[0-9]+$ ]]; then
                    ((n < 1)) && n=1
                    ((n > 5)) && n=5
                    clean="${clean} attempts:${n}"
                fi
                ;;
            rotate | single-request | single-request-reopen | edns0 | trust-ad)
                clean="${clean} ${token}"
                ;;
            no-aaaa)
                if [[ "${DEVCONTAINER_ALLOW_RESOLV_NO_AAAA:-false}" == "true" ]]; then
                    clean="${clean} ${token}"
                else
                    log_warn "DNS fix: ignorando opção resolv.conf diagnóstica no-aaaa sem opt-in explícito."
                fi
                ;;
            *)
                log_warn "DNS fix: ignorando opção resolv.conf não permitida: ${token}"
                ;;
        esac
    done
    clean="${clean# }"
    printf '%s\n' "${clean}"
}

curl_family_args() {
    case "${COPILOT_PROBE_IP_FAMILY}" in
        4) printf '%s\n' '-4' ;;
        6) printf '%s\n' '-6' ;;
        auto) printf '%s\n' '' ;;
        *) printf '%s\n' '-4' ;;
    esac
}

# -----------------------------------------------------------------------------
# NSS / LD_PRELOAD helpers
# -----------------------------------------------------------------------------
resolve_target_user() {
    local current_uid current_user

    if [[ -n "${NSS_TARGET_USER_OVERRIDE}" ]]; then
        printf '%s\n' "${NSS_TARGET_USER_OVERRIDE}"
        return 0
    fi

    current_uid="$(id -u 2> /dev/null || echo unknown)"
    current_user="$(id -un 2> /dev/null || echo unknown)"

    if [[ "${current_uid}" != "0" && "${current_uid}" != "unknown" && -n "${current_user}" && "${current_user}" != "unknown" ]]; then
        printf '%s\n' "${current_user}"
        return 0
    fi

    if [[ -n "${SUDO_USER:-}" && "${SUDO_USER:-}" != "root" ]]; then
        printf '%s\n' "${SUDO_USER}"
        return 0
    fi

    if has_cmd getent && getent passwd node > /dev/null 2>&1; then
        printf '%s\n' 'node'
        return 0
    fi

    printf '%s\n' "${current_user:-root}"
}

resolve_user_uid() {
    local user
    user="$1"
    id -u "${user}" 2> /dev/null || awk -F: -v u="${user}" '$1 == u {print $3; exit}' /etc/passwd 2> /dev/null || true
}

resolve_user_gid() {
    local user
    user="$1"
    id -g "${user}" 2> /dev/null || awk -F: -v u="${user}" '$1 == u {print $4; exit}' /etc/passwd 2> /dev/null || true
}

resolve_user_home() {
    local user
    user="$1"

    if [[ -n "${NSS_TARGET_HOME_OVERRIDE}" ]]; then
        printf '%s\n' "${NSS_TARGET_HOME_OVERRIDE}"
        return 0
    fi

    if has_cmd getent; then
        getent passwd "${user}" 2> /dev/null | awk -F: 'NF >= 6 {print $6; exit}'
        return 0
    fi

    awk -F: -v u="${user}" '$1 == u {print $6; exit}' /etc/passwd 2> /dev/null || true
}

passwd_has_user_uid() {
    local passwd_file user uid
    passwd_file="$1"
    user="$2"
    uid="$3"

    awk -F: -v u="${user}" -v id="${uid}" '$1 == u && $3 == id {found=1} END {exit found ? 0 : 1}' "${passwd_file}" 2> /dev/null
}

resolve_nss_wrapper_lib() {
    local arch candidate

    for candidate in "${NSS_WRAPPER_LIB_CANONICAL}" "/usr/local/lib/devcontainer/libnss_wrapper.so"; do
        if [[ -n "${candidate}" && -r "${candidate}" ]]; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done

    arch="$(uname -m 2> /dev/null || echo x86_64)"

    for candidate in "/usr/lib/${arch}-linux-gnu/libnss_wrapper.so" "/usr/lib/x86_64-linux-gnu/libnss_wrapper.so" "/usr/lib/aarch64-linux-gnu/libnss_wrapper.so"; do
        if [[ -r "${candidate}" ]]; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done

    if has_cmd ldconfig; then
        candidate="$(ldconfig -p 2> /dev/null | awk '/libnss_wrapper\.so/{print $NF; exit}')"
        if [[ -n "${candidate}" && -r "${candidate}" ]]; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    fi

    return 1
}

canonicalize_ld_preload() {
    if [[ -n "${DEVCONTAINER_SKIP_NSS:-}" ]]; then
        log_info "NSS preload canonicalization skipped via DEVCONTAINER_SKIP_NSS."
        return 0
    fi

    local nss_lib old_preload new_preload token old_ifs
    nss_lib="$(resolve_nss_wrapper_lib 2> /dev/null || true)"

    if [[ -z "${nss_lib}" || ! -r "${nss_lib}" ]]; then
        log_warn "NSS wrapper lib não encontrada; LD_PRELOAD não será canonicalizado."
        return 1
    fi

    old_preload="${LD_PRELOAD:-}"
    new_preload=""
    old_ifs="${IFS}"

    IFS=':'
    for token in ${old_preload}; do
        [[ -z "${token}" ]] && continue
        case "${token}" in
            libnss_wrapper.so | */libnss_wrapper.so)
                continue
                ;;
        esac
        if [[ -z "${new_preload}" ]]; then
            new_preload="${token}"
        else
            new_preload="${new_preload}:${token}"
        fi
    done
    IFS="${old_ifs}"

    if [[ -n "${new_preload}" ]]; then
        export LD_PRELOAD="${nss_lib}:${new_preload}"
    else
        export LD_PRELOAD="${nss_lib}"
    fi

    export DEVCONTAINER_NSS_WRAPPER_LIB="${nss_lib}"
    log_info "LD_PRELOAD canonicalizado para NSS wrapper absoluto: ${nss_lib}"
    return 0
}

normalize_nss_wrapper_paths() {
    if [[ -n "${DEVCONTAINER_SKIP_NSS:-}" ]]; then
        log_info "NSS wrapper path normalization skipped via DEVCONTAINER_SKIP_NSS."
        return 0
    fi

    local passwd_file group_file
    passwd_file="${NSS_BASE_DIR}/passwd"
    group_file="${NSS_BASE_DIR}/group"

    export DEVCONTAINER_NSS_DIR="${NSS_BASE_DIR}"

    if [[ -r "${passwd_file}" && -s "${passwd_file}" && -r "${group_file}" && -s "${group_file}" ]]; then
        export NSS_WRAPPER_PASSWD="${passwd_file}"
        export NSS_WRAPPER_GROUP="${group_file}"
        log_info "NSS wrapper paths apontam para artefatos runtime: ${NSS_BASE_DIR}"
        return 0
    fi

    if [[ -r /etc/passwd && -s /etc/passwd && -r /etc/group && -s /etc/group ]]; then
        export NSS_WRAPPER_PASSWD="/etc/passwd"
        export NSS_WRAPPER_GROUP="/etc/group"
        log_info "NSS wrapper paths normalizados para fallback seguro: /etc/passwd, /etc/group"
        return 0
    fi

    unset NSS_WRAPPER_PASSWD 2> /dev/null || true
    unset NSS_WRAPPER_GROUP 2> /dev/null || true
    log_warn "NSS wrapper paths não puderam ser normalizados; bindings foram removidos."
    return 1
}

normalize_nss_runtime_env() {
    local rc
    rc=0
    normalize_nss_wrapper_paths || rc=1
    canonicalize_ld_preload || rc=1
    return "${rc}"
}

check_ld_preload() {
    local val degraded token found_nss old_ifs
    val="${LD_PRELOAD:-}"
    degraded=0
    found_nss=0
    old_ifs="${IFS}"

    if [[ -z "${val}" ]]; then
        log_warn "LD_PRELOAD vazio; NSS wrapper pode não estar ativo."
        return 1
    fi

    if [[ "${val}" == ":"* || "${val}" == *":" || "${val}" == *"::"* ]]; then
        log_warn "LD_PRELOAD contém token vazio: '${val}'"
        degraded=1
    fi

    if ((${#val} > 4096)); then
        log_warn "LD_PRELOAD length=${#val} exceeds safe limit; truncation may occur."
        degraded=1
    fi

    IFS=':'
    for token in ${val}; do
        [[ -z "${token}" ]] && continue
        case "${token}" in
            libnss_wrapper.so)
                log_warn "LD_PRELOAD contém libnss_wrapper.so relativo; esperado caminho absoluto canônico."
                degraded=1
                found_nss=1
                ;;
            */libnss_wrapper.so)
                found_nss=1
                if [[ ! -r "${token}" ]]; then
                    log_warn "LD_PRELOAD aponta para NSS wrapper ilegível/inexistente: ${token}"
                    degraded=1
                else
                    log_info "LD_PRELOAD NSS wrapper OK: ${token}"
                fi
                ;;
        esac
    done
    IFS="${old_ifs}"

    if [[ "${found_nss}" -eq 0 ]]; then
        log_warn "LD_PRELOAD não contém libnss_wrapper.so; NSS wrapper pode não estar ativo."
        degraded=1
    fi

    if [[ -n "${DEVCONTAINER_NSS_WRAPPER_LIB:-}" && ! -r "${DEVCONTAINER_NSS_WRAPPER_LIB}" ]]; then
        log_warn "DEVCONTAINER_NSS_WRAPPER_LIB aponta para arquivo ilegível/inexistente: ${DEVCONTAINER_NSS_WRAPPER_LIB}"
        degraded=1
    fi

    if [[ -n "${NSS_WRAPPER_PASSWD:-}" && (! -r "${NSS_WRAPPER_PASSWD}" || ! -s "${NSS_WRAPPER_PASSWD}") ]]; then
        log_warn "NSS_WRAPPER_PASSWD inválido, ilegível ou vazio: ${NSS_WRAPPER_PASSWD}"
        degraded=1
    fi

    if [[ -n "${NSS_WRAPPER_GROUP:-}" && (! -r "${NSS_WRAPPER_GROUP}" || ! -s "${NSS_WRAPPER_GROUP}") ]]; then
        log_warn "NSS_WRAPPER_GROUP inválido, ilegível ou vazio: ${NSS_WRAPPER_GROUP}"
        degraded=1
    fi

    return "${degraded}"
}

repair_nss_artifacts() {
    local target_user target_uid target_gid target_home
    local passwd_file group_file passwd_tmp group_tmp

    target_user="$(resolve_target_user)"
    target_uid="$(resolve_user_uid "${target_user}")"
    target_gid="$(resolve_user_gid "${target_user}")"
    target_home="$(resolve_user_home "${target_user}")"

    [[ -z "${target_user}" || "${target_user}" == "unknown" ]] && target_user="node"
    [[ -z "${target_uid}" ]] && target_uid="$(id -u 2> /dev/null || echo 1000)"
    [[ -z "${target_gid}" ]] && target_gid="$(id -g 2> /dev/null || echo 1000)"
    [[ -z "${target_home}" ]] && target_home="/home/${target_user}"

    passwd_file="${NSS_BASE_DIR}/passwd"
    group_file="${NSS_BASE_DIR}/group"

    mkdir -p "${NSS_BASE_DIR}" 2>> "${HEALTH_ERROR_LOG}" || return 1
    if [[ ! -w "${NSS_BASE_DIR}" ]]; then
        log_warn "NSS base dir não gravável por $(id -un 2> /dev/null || echo unknown): ${NSS_BASE_DIR}"
        return 1
    fi

    passwd_tmp="$(make_temp_file devcontainer-nss-passwd "${NSS_BASE_DIR}")"
    group_tmp="$(make_temp_file devcontainer-nss-group "${NSS_BASE_DIR}")"
    [[ -n "${passwd_tmp}" && -n "${group_tmp}" ]] || return 1

    if [[ -r /etc/passwd ]]; then
        cat /etc/passwd > "${passwd_tmp}" 2>> "${HEALTH_ERROR_LOG}" || true
    fi
    if [[ -r /etc/group ]]; then
        cat /etc/group > "${group_tmp}" 2>> "${HEALTH_ERROR_LOG}" || true
    fi

    if [[ ! -s "${passwd_tmp}" ]]; then
        printf '%s:x:%s:%s:%s user:%s:/bin/bash\n' \
            "${target_user}" "${target_uid}" "${target_gid}" "${target_user}" "${target_home}" > "${passwd_tmp}" 2>> "${HEALTH_ERROR_LOG}" || return 1
    fi

    if ! passwd_has_user_uid "${passwd_tmp}" "${target_user}" "${target_uid}"; then
        printf '%s:x:%s:%s:%s user:%s:/bin/bash\n' \
            "${target_user}" "${target_uid}" "${target_gid}" "${target_user}" "${target_home}" >> "${passwd_tmp}" 2>> "${HEALTH_ERROR_LOG}" || return 1
    fi

    if [[ ! -s "${group_tmp}" ]]; then
        printf '%s:x:%s:\n' "${target_user}" "${target_gid}" > "${group_tmp}" 2>> "${HEALTH_ERROR_LOG}" || return 1
    fi

    mv -f "${passwd_tmp}" "${passwd_file}" 2>> "${HEALTH_ERROR_LOG}" || return 1
    mv -f "${group_tmp}" "${group_file}" 2>> "${HEALTH_ERROR_LOG}" || return 1
    chmod 600 "${passwd_file}" "${group_file}" 2>> "${HEALTH_ERROR_LOG}" || true

    log_info "NSS artifacts repaired in post-start: ${NSS_BASE_DIR} (target=${target_user}, uid=${target_uid})"
    return 0
}

audit_nss_artifacts() {
    local degraded passwd_file group_file target_user target_uid
    degraded=0
    passwd_file="${NSS_BASE_DIR}/passwd"
    group_file="${NSS_BASE_DIR}/group"

    export DEVCONTAINER_NSS_DIR="${NSS_BASE_DIR}"

    if [[ ! -r "${passwd_file}" || ! -s "${passwd_file}" || ! -r "${group_file}" || ! -s "${group_file}" ]]; then
        repair_nss_artifacts || true
    fi

    normalize_nss_runtime_env || degraded=1

    if [[ -r "${passwd_file}" && -s "${passwd_file}" ]]; then
        log_info "NSS artifact OK: ${passwd_file}"
    else
        log_warn "NSS artifact ausente/vazio/ilegível: ${passwd_file}"
        degraded=1
    fi

    if [[ -r "${group_file}" && -s "${group_file}" ]]; then
        log_info "NSS artifact OK: ${group_file}"
    else
        log_warn "NSS artifact ausente/vazio/ilegível: ${group_file}"
        degraded=1
    fi

    target_user="$(resolve_target_user)"
    target_uid="$(resolve_user_uid "${target_user}")"

    if [[ -r "${passwd_file}" && -s "${passwd_file}" && -n "${target_user}" && -n "${target_uid}" ]]; then
        if passwd_has_user_uid "${passwd_file}" "${target_user}" "${target_uid}"; then
            log_info "NSS passwd coerente com usuário alvo: ${target_user} (uid=${target_uid})"
        else
            log_warn "NSS passwd NÃO contém linha esperada para ${target_user} (uid=${target_uid}) — possível mismatch."
            degraded=1
        fi
    fi

    check_ld_preload || degraded=1
    return "${degraded}"
}

# -----------------------------------------------------------------------------
# DNS baseline
# -----------------------------------------------------------------------------
fix_dns() {
    if [[ "${ENABLE_DNS_FIX}" != "true" ]]; then
        log_info "DNS fix desabilitado por DEVCONTAINER_ENABLE_DNS_FIX=${ENABLE_DNS_FIX}."
        return 0
    fi

    local tmp ns count configured
    count=0
    tmp="$(make_temp_file resolv.conf /tmp)"
    [[ -n "${tmp}" ]] || return 1
    : > "${tmp}" 2>> "${HEALTH_ERROR_LOG}" || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }

    for ns in ${DNS_FIX_SERVERS}; do
        if is_allowed_dns_fix_nameserver "${ns}"; then
            printf 'nameserver %s\n' "${ns}" >> "${tmp}"
            count=$((count + 1))
            if ((count >= DNS_FIX_MAX_NAMESERVERS)); then
                break
            fi
        else
            log_warn "DNS fix: ignorando nameserver inválido ou não permitido: ${ns}"
        fi
    done

    local safe_options
    safe_options="$(sanitize_resolv_options)"
    if [[ -n "${safe_options}" ]]; then
        printf 'options %s\n' "${safe_options}" >> "${tmp}"
    fi

    if [[ "${count}" -eq 0 ]]; then
        log_warn "DNS fix: nenhum nameserver válido em DEVCONTAINER_DNS_FIX_SERVERS."
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    fi

    safe_sudo tee /etc/resolv.conf < "${tmp}" > /dev/null 2>> "${HEALTH_ERROR_LOG}" || {
        log_warn "DNS fix: falha ao sobrescrever conteúdo de /etc/resolv.conf."
        log_error_detail "DNS fix failed while tee-ing /etc/resolv.conf from ${tmp}"
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }

    rm -f "${tmp}" 2> /dev/null || true

    configured="$(awk '/^nameserver/{printf "%s ", $2}' /etc/resolv.conf 2> /dev/null)"
    log_info "DNS configurado: ${configured}"
    return 0
}

run_local_dns_cache_if_enabled() {
    if [[ "${ENABLE_LOCAL_DNS_CACHE}" != "true" ]]; then
        return 2
    fi

    if [[ ! -f "${LOCAL_DNS_CACHE_SCRIPT}" ]]; then
        log_warn "DNS cache local habilitado, mas subscript ausente: ${LOCAL_DNS_CACHE_SCRIPT}"
        return 1
    fi

    log_info "Executando subscript de DNS cache local: ${LOCAL_DNS_CACHE_SCRIPT} action=${LOCAL_DNS_CACHE_POST_START_ACTION}"
    DEVCONTAINER_LOCAL_DNS_ACTION="${LOCAL_DNS_CACHE_POST_START_ACTION}" \
        DEVCONTAINER_LOCAL_DNS_CACHE_ACTION="${LOCAL_DNS_CACHE_POST_START_ACTION}" \
        DEVCONTAINER_LOCAL_DNS_STATUS_FILE="${LOCAL_DNS_CACHE_STATUS_FILE}" \
        DEVCONTAINER_LOCAL_DNS_CACHE_STATUS_FILE="${LOCAL_DNS_CACHE_STATUS_FILE}" \
        DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE="${LOCAL_DNS_CACHE_SUMMARY_FILE}" \
        DEVCONTAINER_LOCAL_DNS_CACHE_SUMMARY_FILE="${LOCAL_DNS_CACHE_SUMMARY_FILE}" \
        DEVCONTAINER_LOCAL_DNS_REPORT_FILE="${LOCAL_DNS_CACHE_REPORT_FILE}" \
        DEVCONTAINER_LOCAL_DNS_METRICS_FILE="${LOCAL_DNS_CACHE_METRICS_FILE}" \
        run_with_timeout "${SUBSCRIPT_TIMEOUT_SECONDS}" bash "${LOCAL_DNS_CACHE_SCRIPT}"
    return $?
}

# -----------------------------------------------------------------------------
# Network delegated scripts
# -----------------------------------------------------------------------------
run_github_api_route_fix() {
    if [[ "${ENABLE_GITHUB_API_ROUTE_FIX}" != "true" ]]; then
        log_info "GitHub API route fix desabilitado por DEVCONTAINER_ENABLE_GITHUB_API_ROUTE_FIX=${ENABLE_GITHUB_API_ROUTE_FIX}."
        return 0
    fi

    if [[ ! -f "${GITHUB_API_ROUTE_SCRIPT}" ]]; then
        log_warn "GitHub API route: subscript ausente: ${GITHUB_API_ROUTE_SCRIPT}"
        return 1
    fi

    log_info "Executando route fix dedicado para ${GITHUB_API_HOST}: ${GITHUB_API_ROUTE_SCRIPT} action=${GITHUB_API_ROUTE_POST_START_ACTION}"
    DEVCONTAINER_GITHUB_API_ROUTE_ACTION="${GITHUB_API_ROUTE_POST_START_ACTION}" \
        DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE="${GITHUB_ROUTE_REPORT_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_STATUS_FILE="${GITHUB_ROUTE_STATUS_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE="${GITHUB_ROUTE_SUMMARY_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_METRICS_FILE="${GITHUB_ROUTE_METRICS_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_FILE="${GITHUB_ROUTE_BENCHMARK_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE="${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_RECOMMENDATION_FILE="${GITHUB_ROUTE_RECOMMENDATION_FILE}" \
        DEVCONTAINER_GITHUB_API_HOST="${GITHUB_API_HOST}" \
        DEVCONTAINER_VERBOSE_NETWORK="${DEVCONTAINER_VERBOSE_NETWORK:-false}" \
        run_with_timeout "${SUBSCRIPT_TIMEOUT_SECONDS}" bash "${GITHUB_API_ROUTE_SCRIPT}"

    return $?
}

run_copilot_network_manager_if_enabled() {
    if [[ "${ENABLE_COPILOT_NETWORK_MANAGER}" != "true" ]]; then
        return 2
    fi

    if [[ ! -f "${COPILOT_NETWORK_MANAGER_SCRIPT}" ]]; then
        log_warn "Copilot network manager habilitado, mas subscript ausente: ${COPILOT_NETWORK_MANAGER_SCRIPT}"
        return 1
    fi

    local boot_transport
    boot_transport="$(manager_recommended_transport_for_boot)"
    log_info "Executando GitHub/Copilot Network Manager: ${COPILOT_NETWORK_MANAGER_SCRIPT} action=${COPILOT_NETWORK_MANAGER_POST_START_ACTION} transport=${boot_transport}"
    DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION="${COPILOT_NETWORK_MANAGER_POST_START_ACTION}" \
        DEVCONTAINER_COPILOT_TRANSPORT_PROFILE="${boot_transport}" \
        DEVCONTAINER_GITHUB_API_HOST="${GITHUB_API_HOST}" \
        DEVCONTAINER_GITHUB_API_ROUTE_SCRIPT="${GITHUB_API_ROUTE_SCRIPT}" \
        DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE="${GITHUB_ROUTE_REPORT_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_STATUS_FILE="${GITHUB_ROUTE_STATUS_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE="${GITHUB_ROUTE_SUMMARY_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_METRICS_FILE="${GITHUB_ROUTE_METRICS_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_FILE="${GITHUB_ROUTE_BENCHMARK_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE="${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_RECOMMENDATION_FILE="${GITHUB_ROUTE_RECOMMENDATION_FILE}" \
        DEVCONTAINER_COPILOT_NETWORK_REPORT_FILE="${COPILOT_NETWORK_REPORT_FILE}" \
        DEVCONTAINER_COPILOT_NETWORK_METRICS_FILE="${COPILOT_NETWORK_METRICS_FILE}" \
        DEVCONTAINER_COPILOT_NETWORK_STATUS_FILE="${COPILOT_NETWORK_STATUS_FILE}" \
        DEVCONTAINER_COPILOT_NETWORK_SUMMARY_FILE="${COPILOT_NETWORK_SUMMARY_FILE}" \
        DEVCONTAINER_COPILOT_NETWORK_DIAGNOSIS_FILE="${COPILOT_NETWORK_DIAGNOSIS_FILE}" \
        DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_FILE="${COPILOT_NETWORK_RECOMMENDATION_FILE}" \
        DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_JSON_FILE="${COPILOT_NETWORK_RECOMMENDATION_JSON_FILE}" \
        DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE="${COPILOT_ENDPOINT_REGISTRY_FILE}" \
        DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY="${COPILOT_ENDPOINT_REGISTRY_FILE}" \
        DEVCONTAINER_COPILOT_USE_ENDPOINT_REGISTRY="${USE_COPILOT_ENDPOINT_REGISTRY}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_SCRIPT="${LOCAL_COPILOT_PROXY_SCRIPT}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_FILE="${LOCAL_COPILOT_PROXY_STATUS_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_SUMMARY_FILE="${LOCAL_COPILOT_PROXY_SUMMARY_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_FILE="${LOCAL_COPILOT_PROXY_BENCHMARK_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE="${LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_COMPARISON_FILE="${LOCAL_COPILOT_PROXY_COMPARISON_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE="${LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE}" \
        DEVCONTAINER_LOCAL_DNS_STATUS_FILE="${LOCAL_DNS_CACHE_STATUS_FILE}" \
        DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE="${LOCAL_DNS_CACHE_SUMMARY_FILE}" \
        DEVCONTAINER_LOCAL_DNS_REPORT_FILE="${LOCAL_DNS_CACHE_REPORT_FILE}" \
        DEVCONTAINER_LOCAL_DNS_METRICS_FILE="${LOCAL_DNS_CACHE_METRICS_FILE}" \
        DEVCONTAINER_LOCAL_DNS_CACHE_STATUS_FILE="${LOCAL_DNS_CACHE_STATUS_FILE}" \
        DEVCONTAINER_LOCAL_DNS_CACHE_SUMMARY_FILE="${LOCAL_DNS_CACHE_SUMMARY_FILE}" \
        DEVCONTAINER_COPILOT_PROBE_ENDPOINTS="${COPILOT_PROBE_ENDPOINTS}" \
        DEVCONTAINER_COPILOT_PROBE_IP_FAMILY="${COPILOT_PROBE_IP_FAMILY}" \
        DEVCONTAINER_COPILOT_PROBE_CONNECT_TIMEOUT="${PROBE_CONNECT_TIMEOUT}" \
        DEVCONTAINER_COPILOT_PROBE_MAX_TIME="${PROBE_MAX_TIME}" \
        run_with_timeout "${SUBSCRIPT_TIMEOUT_SECONDS}" bash "${COPILOT_NETWORK_MANAGER_SCRIPT}"

    return $?
}

run_local_copilot_proxy_if_enabled() {
    # Contract: proxy is observed by default and started only by explicit opt-in.
    if [[ "${ENABLE_LOCAL_COPILOT_PROXY}" != "true" && "${OBSERVE_LOCAL_COPILOT_PROXY_STATUS}" != "true" ]]; then
        return 2
    fi

    if [[ ! -f "${LOCAL_COPILOT_PROXY_SCRIPT}" ]]; then
        if [[ "${ENABLE_LOCAL_COPILOT_PROXY}" == "true" ]]; then
            log_warn "Proxy local Copilot habilitado, mas subscript ausente: ${LOCAL_COPILOT_PROXY_SCRIPT}"
            return 1
        fi
        append_post_start_report "local_copilot_proxy=missing-observe-only script=${LOCAL_COPILOT_PROXY_SCRIPT}"
        return 2
    fi

    log_info "Executando subscript de proxy local Copilot: ${LOCAL_COPILOT_PROXY_SCRIPT} action=${LOCAL_COPILOT_PROXY_POST_START_ACTION} enabled=${ENABLE_LOCAL_COPILOT_PROXY}"
    DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION="${LOCAL_COPILOT_PROXY_POST_START_ACTION}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_ENV_FILE="${LOCAL_COPILOT_PROXY_ENV_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_FILE="${LOCAL_COPILOT_PROXY_STATUS_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_SUMMARY_FILE="${LOCAL_COPILOT_PROXY_SUMMARY_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_REPORT_FILE="${LOCAL_COPILOT_PROXY_REPORT_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_METRICS_FILE="${LOCAL_COPILOT_PROXY_METRICS_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_FILE="${LOCAL_COPILOT_PROXY_BENCHMARK_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE="${LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_COMPARISON_FILE="${LOCAL_COPILOT_PROXY_COMPARISON_FILE}" \
        DEVCONTAINER_LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE="${LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE}" \
        run_with_timeout "${SUBSCRIPT_TIMEOUT_SECONDS}" bash "${LOCAL_COPILOT_PROXY_SCRIPT}"
    return $?
}

is_safe_proxy_env_assignment() {
    local key value
    key="${1:-}"
    value="${2:-}"
    [[ "${value}" != *$'\n'* && "${value}" != *$'\r'* && "${value}" != *$'\t'* ]] || return 1
    case "${key}" in
        HTTP_PROXY | HTTPS_PROXY | http_proxy | https_proxy | ALL_PROXY | all_proxy)
            [[ "${value}" =~ ^http://(127\.0\.0\.1|localhost|\[::1\]):[0-9]+/?$ ]] || return 1
            [[ "${value}" != *'@'* ]] || return 1
            ;;
        NO_PROXY | no_proxy)
            [[ ${#value} -le 2048 ]] || return 1
            ;;
        *) return 1 ;;
    esac
    return 0
}

source_local_copilot_proxy_env_for_hook_if_enabled() {
    local line key value loaded
    if [[ "${ALLOW_SOURCE_LOCAL_PROXY_ENV}" != "true" ]]; then
        append_post_start_report "proxy_env_source=skipped opt_in=false"
        return 0
    fi
    if [[ ! -r "${LOCAL_COPILOT_PROXY_ENV_FILE}" ]]; then
        append_post_start_report "proxy_env_source=skipped missing=${LOCAL_COPILOT_PROXY_ENV_FILE}"
        return 0
    fi

    loaded=0
    while IFS= read -r line || [[ -n "${line}" ]]; do
        line="${line#export }"
        case "${line}" in
            '' | \#*) continue ;;
            *=*) : ;;
            *) continue ;;
        esac
        key="${line%%=*}"
        value="${line#*=}"
        case "${value}" in
            \"*\")
                value="${value#\"}"
                value="${value%\"}"
                ;;
            \'*\')
                value="${value#\'}"
                value="${value%\'}"
                ;;
        esac
        if is_safe_proxy_env_assignment "${key}" "${value}"; then
            export "${key}=${value}"
            loaded=$((loaded + 1))
            append_post_start_report "proxy_env_source_key=${key} value=$(redact_url_credentials "${value}")"
        else
            append_post_start_report "proxy_env_source_ignored_key=${key}"
        fi
    done < "${LOCAL_COPILOT_PROXY_ENV_FILE}"

    if ((loaded > 0)); then
        append_post_start_report "proxy_env_source=ok file=${LOCAL_COPILOT_PROXY_ENV_FILE} keys=${loaded}"
        log_info "Env do proxy local carregado de forma sanitizada apenas para subprocessos deste post-start."
        return 0
    fi

    append_post_start_report "proxy_env_source=no-safe-keys file=${LOCAL_COPILOT_PROXY_ENV_FILE}"
    return 1
}

# -----------------------------------------------------------------------------
# NSS DB — initialize VS Code/Chromium trust store on Linux
# -----------------------------------------------------------------------------
init_nss_db() {
    local target_user target_gid target_home nssdb current_user custom_dir imported crt_file ca_name

    if ! has_cmd certutil; then
        log_warn "NSS DB: certutil não encontrado (libnss3-tools não instalado); ignorado."
        return 1
    fi

    target_user="$(resolve_target_user)"
    target_gid="$(resolve_user_gid "${target_user}")"
    target_home="$(resolve_user_home "${target_user}")"
    current_user="$(id -un 2> /dev/null || echo unknown)"

    [[ -z "${target_home}" ]] && target_home="${HOME:-/home/${target_user}}"
    [[ -z "${target_gid}" ]] && target_gid="$(id -g 2> /dev/null || echo 1000)"

    nssdb="${target_home}/.pki/nssdb"
    mkdir -p "${nssdb}" 2>> "${HEALTH_ERROR_LOG}" || {
        log_warn "NSS DB: falha ao criar ${nssdb}."
        return 1
    }

    if [[ "${current_user}" == "root" && "${target_user}" != "root" ]]; then
        safe_sudo chown "${target_user}:${target_gid}" "${target_home}/.pki" "${nssdb}" 2>> "${HEALTH_ERROR_LOG}" || true
    fi

    if [[ -d "${nssdb}" ]]; then
        if certutil -L -d "sql:${nssdb}" > /dev/null 2>> "${HEALTH_ERROR_LOG}"; then
            log_info "NSS DB OK: ${nssdb} (target=${target_user})"
            return 0
        fi

        log_warn "NSS DB corrompido: ${nssdb} — removendo e recriando. Veja ${HEALTH_ERROR_LOG}."
        rm -rf "${nssdb}" 2>> "${HEALTH_ERROR_LOG}" || true
        mkdir -p "${nssdb}" 2>> "${HEALTH_ERROR_LOG}" || return 1
        if [[ "${current_user}" == "root" && "${target_user}" != "root" ]]; then
            safe_sudo chown "${target_user}:${target_gid}" "${nssdb}" 2>> "${HEALTH_ERROR_LOG}" || true
        fi
    fi

    certutil -d "sql:${nssdb}" -N -f /dev/null > /dev/null 2>> "${HEALTH_ERROR_LOG}" || {
        log_warn "NSS DB: certutil -N falhou. Veja ${HEALTH_ERROR_LOG}."
        return 1
    }

    log_info "NSS DB criado: ${nssdb} (target=${target_user})"

    custom_dir="/usr/local/share/ca-certificates"
    imported=0

    if [[ -d "${custom_dir}" ]]; then
        while IFS= read -r -d '' crt_file; do
            ca_name="$(basename "${crt_file}" .crt)"
            if certutil -A -d "sql:${nssdb}" -n "custom-${ca_name}" -t "CT,," -i "${crt_file}" > /dev/null 2>> "${HEALTH_ERROR_LOG}"; then
                imported=$((imported + 1))
            fi
        done < <(find "${custom_dir}" -maxdepth 2 -name '*.crt' -print0 2> /dev/null)

        [[ "${imported}" -gt 0 ]] && log_info "NSS DB: ${imported} CA(s) customizado(s) importado(s)"
    fi

    return 0
}

# -----------------------------------------------------------------------------
# Connectivity probes
# -----------------------------------------------------------------------------
expected_status_ok_for_url() {
    local url code
    url="$1"
    code="$2"

    case "${url}" in
        https://api.github.com/user*)
            [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]
            return $?
            ;;
        https://api.github.com/rate_limit*)
            [[ "${code}" == "200" ]]
            return $?
            ;;
        https://api.github.com/copilot_internal/*)
            [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" || "${code}" == "404" ]]
            return $?
            ;;
        https://api.github.com | https://api.github.com/)
            [[ "${code}" == "200" || "${code}" == "403" || "${code}" == "429" ]]
            return $?
            ;;
        https://github.com/login* | https://github.com/copilot*)
            [[ "${code}" == "200" || "${code}" == "301" || "${code}" == "302" || "${code}" == "303" || "${code}" == "307" || "${code}" == "308" || "${code}" == "401" || "${code}" == "403" || "${code}" == "404" ]]
            return $?
            ;;
        https://copilot-proxy.githubusercontent.com* | https://origin-tracker.githubusercontent.com* | https://copilot-telemetry.githubusercontent.com* | https://collector.github.com* | https://default.exp-tas.com* | https://uploads.github.com* | https://user-images.githubusercontent.com* | https://api.githubcopilot.com* | https://api.individual.githubcopilot.com* | https://proxy.individual.githubcopilot.com* | https://api.business.githubcopilot.com* | https://proxy.business.githubcopilot.com* | https://api.enterprise.githubcopilot.com* | https://proxy.enterprise.githubcopilot.com* | https://copilot-reports.github.com* | https://copilot-reports-*.b01.azurefd.net* | https://usagereports*.blob.core.windows.net*)
            [[ "${code}" == "200" || "${code}" == "204" || "${code}" == "301" || "${code}" == "302" || "${code}" == "303" || "${code}" == "307" || "${code}" == "308" || "${code}" == "400" || "${code}" == "401" || "${code}" == "403" || "${code}" == "404" || "${code}" == "405" ]]
            return $?
            ;;
        *)
            [[ "${code}" != "000" && -n "${code}" ]]
            return $?
            ;;
    esac
}

should_skip_probe_url() {
    local url route_fix_ok
    url="$1"
    route_fix_ok="$2"

    [[ "${SKIP_GITHUB_API_PROBES_AFTER_ROUTE_FIX}" == "true" ]] || return 1
    [[ "${route_fix_ok}" == "true" ]] || return 1

    case "${url}" in
        https://api.github.com | https://api.github.com/*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

write_probe_headers() {
    ensure_parent_dir "${COPILOT_NETWORK_REPORT_FILE}"
    ensure_parent_dir "${COPILOT_NETWORK_METRICS_FILE}"
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'probe_ip_family=%s\n' "${COPILOT_PROBE_IP_FAMILY}"
        printf 'connect_timeout=%s\n' "${PROBE_CONNECT_TIMEOUT}"
        printf 'max_time=%s\n' "${PROBE_MAX_TIME}"
        printf 'extended_probes=%s\n' "${ENABLE_EXTENDED_COPILOT_PROBES}"
        printf 'endpoints=%s\n' "${COPILOT_PROBE_ENDPOINTS}"
        printf '\n'
    } > "${COPILOT_NETWORK_REPORT_FILE}" 2> /dev/null || true

    printf 'timestamp\turl\thttp_code\tremote_ip\tdns_ms\ttcp_ms\ttls_ms\tttfb_ms\ttotal_ms\ttls_verify\tcontent_type\tstatus\n' > "${COPILOT_NETWORK_METRICS_FILE}" 2> /dev/null || true
}

probe_copilot_connectivity() {
    local route_fix_ok failed url result http_code ctype time_name time_connect time_tls time_start time_total remote_ip tls_verify
    local dns_ms tcp_ms tls_ms ttfb_ms total_ms status family_arg

    route_fix_ok="${1:-false}"
    failed=0

    if [[ "${ENABLE_COPILOT_ENDPOINT_PROBES}" != "true" ]]; then
        log_info "Copilot endpoint probes desabilitados por DEVCONTAINER_ENABLE_COPILOT_ENDPOINT_PROBES=${ENABLE_COPILOT_ENDPOINT_PROBES}."
        write_status_file "${COPILOT_NETWORK_STATUS_FILE}" "skipped"
        return 0
    fi

    if ! has_cmd curl; then
        log_warn "Copilot probe: curl não encontrado — ignorado."
        write_status_file "${COPILOT_NETWORK_STATUS_FILE}" "degraded"
        return 1
    fi

    write_probe_headers
    family_arg="$(curl_family_args)"

    for url in ${COPILOT_PROBE_ENDPOINTS}; do
        if should_skip_probe_url "${url}" "${route_fix_ok}"; then
            log_info "Copilot probe skip: ${url} já validado pelo GitHub API route fix."
            continue
        fi

        if ! is_safe_copilot_probe_url "${url}"; then
            log_warn "Copilot probe ignorado por URL inválida ou fora da allowlist local: ${url}"
            failed=1
            {
                printf '%s	%s	%s	%s	%s	%s	%s	%s	%s	%s	%s	%s
' \
                    "$(ts)" "${url}" "000" "unknown" "0" "0" "0" "0" "0" "?" "none" "invalid-url"
            } >> "${COPILOT_NETWORK_METRICS_FILE}" 2> /dev/null || true
            continue
        fi

        if [[ -n "${family_arg}" ]]; then
            result="$(LC_ALL=C curl "${family_arg}" -sS -o /dev/null --connect-timeout "${PROBE_CONNECT_TIMEOUT}" --max-time "${PROBE_MAX_TIME}" \
                -w 'http_code=%{http_code}|content_type=%{content_type}|time_namelookup=%{time_namelookup}|time_connect=%{time_connect}|time_appconnect=%{time_appconnect}|time_starttransfer=%{time_starttransfer}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}' \
                "${url}" 2>> "${HEALTH_ERROR_LOG}" || true)"
        else
            result="$(LC_ALL=C curl -sS -o /dev/null --connect-timeout "${PROBE_CONNECT_TIMEOUT}" --max-time "${PROBE_MAX_TIME}" \
                -w 'http_code=%{http_code}|content_type=%{content_type}|time_namelookup=%{time_namelookup}|time_connect=%{time_connect}|time_appconnect=%{time_appconnect}|time_starttransfer=%{time_starttransfer}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}' \
                "${url}" 2>> "${HEALTH_ERROR_LOG}" || true)"
        fi

        http_code="$(extract_field http_code "${result}")"
        ctype="$(extract_field content_type "${result}")"
        time_name="$(extract_field time_namelookup "${result}")"
        time_connect="$(extract_field time_connect "${result}")"
        time_tls="$(extract_field time_appconnect "${result}")"
        time_start="$(extract_field time_starttransfer "${result}")"
        time_total="$(extract_field time_total "${result}")"
        remote_ip="$(extract_field remote_ip "${result}")"
        tls_verify="$(extract_field ssl_verify_result "${result}")"

        dns_ms="$(float_ms "${time_name}")"
        tcp_ms="$(float_ms "${time_connect}")"
        tls_ms="$(float_ms "${time_tls}")"
        ttfb_ms="$(float_ms "${time_start}")"
        total_ms="$(float_ms "${time_total}")"
        status="ok"

        if [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
            status="fail"
            log_warn "Copilot probe FALHOU: ${url} → IP ${remote_ip:-unknown} (sem resposta; TCP ${time_connect:-0}s; total ${time_total:-0}s)"
            failed=1
        elif [[ "${tls_verify}" != "0" ]]; then
            status="tls-fail"
            log_warn "Copilot probe TLS ERRO (${tls_verify:-?}): ${url} → HTTP ${http_code} | IP ${remote_ip:-unknown} | TCP ${time_connect:-0}s"
            failed=1
        elif ! expected_status_ok_for_url "${url}" "${http_code}"; then
            status="unexpected-http"
            log_warn "Copilot probe HTTP inesperado: ${url} → HTTP ${http_code} | IP ${remote_ip:-unknown} | ctype=${ctype:-none} | TLS OK"
            failed=1
        else
            log_ok "Copilot probe OK: ${url} → HTTP ${http_code} | IP ${remote_ip:-unknown} | DNS ${dns_ms}ms | TCP ${tcp_ms}ms | TLS ${tls_ms}ms | total ${total_ms}ms"
        fi

        {
            printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
                "$(ts)" "${url}" "${http_code:-000}" "${remote_ip:-unknown}" "${dns_ms}" "${tcp_ms}" "${tls_ms}" "${ttfb_ms}" "${total_ms}" "${tls_verify:-?}" "${ctype:-none}" "${status}"
        } >> "${COPILOT_NETWORK_METRICS_FILE}" 2> /dev/null || true

        {
            printf 'probe url=%s http=%s remote_ip=%s dns_ms=%s tcp_ms=%s tls_ms=%s ttfb_ms=%s total_ms=%s tls_verify=%s status=%s\n' \
                "${url}" "${http_code:-000}" "${remote_ip:-unknown}" "${dns_ms}" "${tcp_ms}" "${tls_ms}" "${ttfb_ms}" "${total_ms}" "${tls_verify:-?}" "${status}"
        } >> "${COPILOT_NETWORK_REPORT_FILE}" 2> /dev/null || true
    done

    if [[ "${failed}" -eq 0 ]]; then
        write_status_file "${COPILOT_NETWORK_STATUS_FILE}" "ok"
    else
        write_status_file "${COPILOT_NETWORK_STATUS_FILE}" "degraded"
    fi

    return "${failed}"
}

# -----------------------------------------------------------------------------
# Other passive diagnostics
# -----------------------------------------------------------------------------
audit_initialized_marker() {
    if [[ -f "${PROJECT_ROOT}/.devcontainer/.initialized" ]]; then
        log_info "Marker encontrado: .devcontainer/.initialized"
        return 0
    fi

    log_warn "Marker ausente: .devcontainer/.initialized (post-create pode ter falhado ou não rodou)."
    return 0
}

run_make_info() {
    if ! has_cmd make; then
        log_warn "make não encontrado no PATH."
        return 1
    fi

    run_with_timeout "${MAKE_INFO_TIMEOUT_SECONDS}" make info > /dev/null 2>> "${HEALTH_ERROR_LOG}"
    return $?
}

audit_ssh() {
    case "${SSH_AUDIT_MODE}" in
        false | off | disabled | none)
            log_info "SSH audit desabilitado por DEVCONTAINER_SSH_AUDIT_MODE=${SSH_AUDIT_MODE}."
            return 0
            ;;
        attach-only)
            log_info "SSH audit adiado para postAttach por DEVCONTAINER_SSH_AUDIT_MODE=attach-only."
            return 0
            ;;
        auto | true | on | enabled)
            :
            ;;
        *)
            log_warn "SSH audit mode desconhecido (${SSH_AUDIT_MODE}); usando modo auto."
            ;;
    esac

    local ssh_key_found key
    ssh_key_found=false

    for key in id_rsa id_dsa id_ecdsa id_ed25519; do
        if [[ -s "${HOME:-/home/node}/.ssh/${key}" ]]; then
            ssh_key_found=true
            log_info "SSH private key presente: ~/.ssh/${key}"
            break
        fi
    done

    if [[ "${ssh_key_found}" == "false" ]]; then
        if [[ -n "${SSH_AUTH_SOCK:-}" ]] && has_cmd ssh-add; then
            if ssh-add -L > /dev/null 2>> "${HEALTH_ERROR_LOG}"; then
                log_info "Nenhuma chave em ~/.ssh, mas agente SSH encaminhado detectado."
                ssh_key_found=true
            else
                log_info "SSH_AUTH_SOCK presente, mas ssh-add -L ainda não retornou chaves; estado comum antes do postAttach."
            fi
        else
            log_info "Nenhuma chave SSH privada/agente detectado no postStart; normal antes do postAttach em alguns fluxos VS Code."
        fi
    fi

    if [[ "${ENABLE_SSHD_CHECK}" != "true" ]]; then
        log_info "SSHD check skipped via DEVCONTAINER_ENABLE_SSHD_CHECK."
    else
        if has_cmd sshd; then
            log_info "sshd está instalado."
        else
            log_info "sshd não encontrado; acesso inbound via SSH permanece desabilitado (estado esperado)."
        fi
    fi
}

run_sync_local_auth() {
    local script
    script="${SCRIPT_DIR}/sync-local-auth.sh"
    if [[ -f "${script}" ]]; then
        bash "${script}" || log_warn "sync-local-auth.sh falhou (WARN only)."
    fi
}

# -----------------------------------------------------------------------------
# Main execution — always fail-safe
# -----------------------------------------------------------------------------
main() {
    local status network_status diagnostics_status github_api_route_fix_ok
    local nss_env_rc dns_rc dns_cache_rc proxy_rc manager_rc github_api_route_rc make_rc nss_rc probe_rc
    local dns_cache_status proxy_status manager_status run_legacy_probes manager_was_invoked

    status="ok"
    network_status="ok"
    diagnostics_status="ok"
    github_api_route_fix_ok="false"
    run_legacy_probes="true"
    manager_was_invoked="false"

    ensure_parent_dir "${HEALTH_ERROR_LOG}"
    : > "${HEALTH_ERROR_LOG}" 2> /dev/null || true
    write_post_start_report_header

    log_info "Hook de start acionado (não-bloqueante)."
    log_info "Versão: v${SCRIPT_VERSION}"
    log_info "PWD: ${PWD:-unknown}"
    log_info "Project root: ${PROJECT_ROOT}"
    log_info "User: $(id -un 2> /dev/null || echo unknown) (uid=$(id -u 2> /dev/null || echo unknown), gid=$(id -g 2> /dev/null || echo unknown))"
    log_info "NSS_BASE_DIR: ${NSS_BASE_DIR}"
    log_info "NSS target user: $(resolve_target_user)"
    log_info "LD_PRELOAD inicial: ${LD_PRELOAD:-<unset>}"
    log_info "Local DNS cache: ${LOCAL_DNS_CACHE_SCRIPT} (enabled=${ENABLE_LOCAL_DNS_CACHE})"
    log_info "Local Copilot proxy: ${LOCAL_COPILOT_PROXY_SCRIPT} (enabled=${ENABLE_LOCAL_COPILOT_PROXY})"
    log_info "GitHub API route script: ${GITHUB_API_ROUTE_SCRIPT}"
    log_info "Copilot Network Manager: ${COPILOT_NETWORK_MANAGER_SCRIPT} (enabled=${ENABLE_COPILOT_NETWORK_MANAGER})"
    log_info "Route report: ${GITHUB_ROUTE_REPORT_FILE}"
    log_info "Route summary: ${GITHUB_ROUTE_SUMMARY_FILE}"
    log_info "Route metrics: ${GITHUB_ROUTE_METRICS_FILE}"
    log_info "Local DNS summary: ${LOCAL_DNS_CACHE_SUMMARY_FILE}"
    log_info "Copilot network diagnosis: ${COPILOT_NETWORK_DIAGNOSIS_FILE}"
    log_info "Copilot network recommendation: ${COPILOT_NETWORK_RECOMMENDATION_FILE}"
    log_info "Copilot network report: ${COPILOT_NETWORK_REPORT_FILE}"
    log_info "Copilot network summary: ${COPILOT_NETWORK_SUMMARY_FILE}"
    log_info "Health error log: ${HEALTH_ERROR_LOG}"
    log_debug "Debug habilitado por DEVCONTAINER_VERBOSE_NETWORK=${DEVCONTAINER_VERBOSE_NETWORK:-false}."
    log_debug "PATH=${PATH:-<unset>}"
    log_debug "SHELL=${SHELL:-<unset>}"
    log_debug "HOME=${HOME:-<unset>}"
    log_debug "DNS_FIX_SERVERS=${DNS_FIX_SERVERS}"
    log_debug "DNS_FIX_OPTIONS=${DNS_FIX_OPTIONS}"
    log_debug "COPILOT_PROBE_IP_FAMILY=${COPILOT_PROBE_IP_FAMILY}"
    log_debug "COPILOT_PROBE_ENDPOINTS=${COPILOT_PROBE_ENDPOINTS}"
    log_debug "BOOT_TRANSPORT_PROFILE=${BOOT_TRANSPORT_PROFILE}; APPLY_TRANSPORT_RECOMMENDATION=${POST_START_APPLY_TRANSPORT_RECOMMENDATION}"

    if ! is_safe_hostname "${GITHUB_API_HOST}"; then
        status="degraded"
        network_status="degraded"
        log_warn "GITHUB_API_HOST inválido/não seguro: ${GITHUB_API_HOST}"
        append_post_start_report "github_api_host=invalid value=${GITHUB_API_HOST}"
    fi

    log_info "Normalizando ambiente NSS/LD_PRELOAD para subprocessos do hook..."
    normalize_nss_runtime_env
    nss_env_rc=$?
    if [[ "${nss_env_rc}" -ne 0 ]]; then
        log_warn "Normalização inicial de NSS/LD_PRELOAD degradada; audit_nss_artifacts tentará reparar artefatos depois."
        append_post_start_report "nss_env=degraded rc=${nss_env_rc}"
    else
        append_post_start_report "nss_env=ok"
    fi
    log_info "LD_PRELOAD após normalização: ${LD_PRELOAD:-<unset>}"
    log_info "DEVCONTAINER_NSS_WRAPPER_LIB: ${DEVCONTAINER_NSS_WRAPPER_LIB:-<unset>}"
    log_info "NSS_WRAPPER_PASSWD: ${NSS_WRAPPER_PASSWD:-<unset>}"
    log_info "NSS_WRAPPER_GROUP: ${NSS_WRAPPER_GROUP:-<unset>}"

    run_local_dns_cache_if_enabled
    dns_cache_rc=$?
    dns_cache_status="$(read_status_value "${LOCAL_DNS_CACHE_STATUS_FILE}")"
    append_post_start_report "local_dns_cache_rc=${dns_cache_rc} local_dns_cache_status=${dns_cache_status}"
    if [[ "${dns_cache_rc}" -eq 0 ]] && local_dns_cache_proven_ok; then
        log_ok "DNS cache local comprovadamente ativo e saudável."
        append_summary_snapshot_to_report "local_dns_cache_summary" "${LOCAL_DNS_CACHE_SUMMARY_FILE}"
    elif [[ "${dns_cache_rc}" -eq 0 ]] && local_dns_cache_is_off_status; then
        log_info "DNS cache local retornou status=${dns_cache_status}."
        if [[ "${DNS_BASELINE_ON_CACHE_OFF}" == "true" ]]; then
            log_info "Usando DNS fix baseline porque o cache local está off/skipped."
            fix_dns
            dns_rc=$?
            if [[ "${dns_rc}" -ne 0 ]]; then
                status="degraded"
                network_status="degraded"
                log_warn "Fix de DNS baseline não aplicado — resolução de nomes pode falhar."
            fi
        fi
    elif [[ "${dns_cache_rc}" -eq 0 && "${dns_cache_status}" == "ok" ]]; then
        diagnostics_status="degraded"
        log_warn "DNS cache local declarou ok, mas não houve prova completa de dnsmasq/resolv.conf saudável; aplicando baseline conservador."
        append_summary_snapshot_to_report "local_dns_cache_summary" "${LOCAL_DNS_CACHE_SUMMARY_FILE}"
        if [[ "${DNS_BASELINE_ON_CACHE_FAILURE}" == "true" ]]; then
            fix_dns || network_status="degraded"
        fi
    elif [[ "${dns_cache_rc}" -eq 2 ]]; then
        log_info "DNS cache local não habilitado."
        if [[ "${DNS_BASELINE_ON_CACHE_OFF}" == "true" ]]; then
            log_info "Usando DNS fix baseline se configurado."
            fix_dns
            dns_rc=$?
            if [[ "${dns_rc}" -ne 0 ]]; then
                status="degraded"
                network_status="degraded"
                log_warn "Fix de DNS baseline não aplicado — resolução de nomes pode falhar."
            fi
        fi
    else
        status="degraded"
        network_status="degraded"
        log_warn "DNS cache local falhou/degradou."
        append_summary_snapshot_to_report "local_dns_cache_summary" "${LOCAL_DNS_CACHE_SUMMARY_FILE}"
        if [[ "${DNS_BASELINE_ON_CACHE_FAILURE}" == "true" ]]; then
            log_warn "Tentando DNS fix baseline como fallback controlado."
            fix_dns || true
        else
            append_post_start_report "dns_baseline_fallback=skipped reason=cache-failure opt_in=false"
        fi
    fi

    run_local_copilot_proxy_if_enabled
    proxy_rc=$?
    proxy_status="$(read_status_value "${LOCAL_COPILOT_PROXY_STATUS_FILE}")"
    append_post_start_report "local_copilot_proxy_rc=${proxy_rc} local_copilot_proxy_status=${proxy_status}"
    if [[ "${proxy_rc}" -eq 0 && "${proxy_status}" == "ok" ]]; then
        log_ok "Proxy local Copilot OK/status=${proxy_status}; action=${LOCAL_COPILOT_PROXY_POST_START_ACTION}."
        source_local_copilot_proxy_env_for_hook_if_enabled || true
    elif [[ "${proxy_rc}" -eq 0 && ("${proxy_status}" == "off" || "${proxy_status}" == "stopped" || "${proxy_status}" == "unknown") ]]; then
        log_info "Proxy local Copilot observado sem ativação. status=${proxy_status}; action=${LOCAL_COPILOT_PROXY_POST_START_ACTION}."
    elif [[ "${proxy_rc}" -eq 2 ]]; then
        log_info "Proxy local Copilot não habilitado e observação indisponível/ignorada."
    elif [[ "${proxy_rc}" -eq 1 && "${ENABLE_LOCAL_COPILOT_PROXY}" == "true" ]]; then
        diagnostics_status="degraded"
        log_warn "Proxy local Copilot solicitado mas não aplicado. Continuando sem proxy local."
    else
        append_post_start_report "local_copilot_proxy_observation=nonfatal rc=${proxy_rc} status=${proxy_status}"
    fi
    append_summary_snapshot_to_report "local_copilot_proxy_summary" "${LOCAL_COPILOT_PROXY_SUMMARY_FILE}"
    append_summary_snapshot_to_report "local_copilot_proxy_recommendation" "${LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE}"

    run_copilot_network_manager_if_enabled
    manager_rc=$?
    manager_status="$(read_status_value "${COPILOT_NETWORK_STATUS_FILE}")"
    append_post_start_report "copilot_network_manager_rc=${manager_rc} copilot_network_status=${manager_status}"

    if [[ "${manager_rc}" -eq 0 ]]; then
        manager_was_invoked="true"
        append_summary_snapshot_to_report "copilot_network_summary" "${COPILOT_NETWORK_SUMMARY_FILE}"
        append_summary_snapshot_to_report "copilot_network_diagnosis" "${COPILOT_NETWORK_DIAGNOSIS_FILE}"
        append_summary_snapshot_to_report "copilot_network_recommendation" "${COPILOT_NETWORK_RECOMMENDATION_FILE}"
        append_summary_snapshot_to_report "github_route_recommendation" "${GITHUB_ROUTE_RECOMMENDATION_FILE}"
        append_summary_snapshot_to_report "local_copilot_proxy_recommendation" "${LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE}"
        github_api_route_fix_ok="$(route_fix_proven_ok)"
        log_ok "GitHub/Copilot Network Manager concluiu. status=${manager_status}; github_api_route_fix_ok=${github_api_route_fix_ok}"
        if [[ "${manager_status}" == "degraded" || "${manager_status}" == "fail" || "${manager_status}" == "failed" ]]; then
            network_status="degraded"
        fi
        if [[ "${LEGACY_PROBES_AFTER_MANAGER}" != "true" ]]; then
            run_legacy_probes="false"
        fi
    elif [[ "${manager_rc}" -eq 2 ]]; then
        log_info "GitHub/Copilot Network Manager não habilitado; usando fluxo modular legado/compatível."
        run_github_api_route_fix
        github_api_route_rc=$?
        append_post_start_report "github_api_route_fix_rc=${github_api_route_rc} mode=legacy"
        if [[ "${github_api_route_rc}" -ne 0 ]]; then
            status="degraded"
            network_status="degraded"
            log_warn "Fix inteligente de rota para ${GITHUB_API_HOST} não aplicado — Copilot pode falhar se a rota DNS padrão estiver ruim."
            append_summary_snapshot_to_report "github_route_summary" "${GITHUB_ROUTE_SUMMARY_FILE}"
            append_summary_snapshot_to_report "github_route_recommendation" "${GITHUB_ROUTE_RECOMMENDATION_FILE}"
        else
            append_summary_snapshot_to_report "github_route_summary" "${GITHUB_ROUTE_SUMMARY_FILE}"
            append_summary_snapshot_to_report "github_route_recommendation" "${GITHUB_ROUTE_RECOMMENDATION_FILE}"
            github_api_route_fix_ok="$(route_fix_proven_ok)"
        fi
    else
        manager_was_invoked="true"
        status="degraded"
        network_status="degraded"
        log_warn "GitHub/Copilot Network Manager falhou; tentando route-fix dedicado para ${GITHUB_API_HOST}."
        run_github_api_route_fix
        github_api_route_rc=$?
        append_post_start_report "github_api_route_fix_rc=${github_api_route_rc} mode=fallback-after-manager"
        if [[ "${github_api_route_rc}" -eq 0 ]]; then
            append_summary_snapshot_to_report "github_route_summary" "${GITHUB_ROUTE_SUMMARY_FILE}"
            append_summary_snapshot_to_report "github_route_recommendation" "${GITHUB_ROUTE_RECOMMENDATION_FILE}"
            github_api_route_fix_ok="$(route_fix_proven_ok)"
        fi
        run_legacy_probes="true"
    fi

    run_make_info
    make_rc=$?
    if [[ "${make_rc}" -ne 0 ]]; then
        diagnostics_status="degraded"
        log_warn "make info falhou (rc=${make_rc}, timeout=${MAKE_INFO_TIMEOUT_SECONDS}s) — diagnóstico degradado, sem degradar health estrutural."
    else
        log_info "make info executado com sucesso."
    fi
    append_post_start_report "make_info_rc=${make_rc}"

    audit_nss_artifacts
    nss_rc=$?
    if [[ "${nss_rc}" -ne 0 ]]; then
        status="degraded"
        log_warn "NSS audit degradado (artefatos ausentes/mismatch)."
        log_warn "Ação recomendada: Rebuild Container OU execute manualmente: .devcontainer/scripts/post-create.sh (com REEXECUTE_POST_CREATE=true se aplicável)."
    fi
    append_post_start_report "nss_audit_rc=${nss_rc}"

    audit_initialized_marker || true
    init_nss_db || true

    if [[ "${run_legacy_probes}" == "true" ]]; then
        log_info "Verificando conectividade com endpoints GitHub/Copilot/VS Code relevantes via probes legados..."
        probe_copilot_connectivity "${github_api_route_fix_ok}"
        probe_rc=$?
        append_post_start_report "legacy_probe_rc=${probe_rc}"
        if [[ "${probe_rc}" -ne 0 ]]; then
            network_status="degraded"
            log_warn "Um ou mais endpoints relevantes não responderam como esperado. Veja ${GITHUB_ROUTE_REPORT_FILE}, ${COPILOT_NETWORK_REPORT_FILE}, ${COPILOT_NETWORK_METRICS_FILE} e ${HEALTH_ERROR_LOG}."
        else
            log_ok "Todos os probes de rede relevantes responderam."
        fi
    else
        log_info "Probes legados ignorados: Network Manager já gerou métricas/status."
        append_post_start_report "legacy_probe_rc=skipped manager_was_invoked=${manager_was_invoked}"
    fi

    audit_ssh || true
    run_sync_local_auth || true

    write_status_file "${HEALTH_STATUS_FILE}" "${status}"
    write_status_file "${NETWORK_STATUS_FILE}" "${network_status}"
    write_status_file "${DIAGNOSTICS_STATUS_FILE}" "${diagnostics_status}"
    write_post_start_summary "${status}" "${network_status}" "${diagnostics_status}"

    log_info "health.status=${status} (${HEALTH_STATUS_FILE})"
    log_info "network.status=${network_status} (${NETWORK_STATUS_FILE})"
    log_info "diagnostics.status=${diagnostics_status} (${DIAGNOSTICS_STATUS_FILE})"
    log_info "copilot.network.status=$(read_status_value "${COPILOT_NETWORK_STATUS_FILE}") (${COPILOT_NETWORK_STATUS_FILE})"
    log_info "post-start.report=${POST_START_REPORT_FILE}"
    log_info "post-start.summary=${POST_START_SUMMARY_FILE}"

    append_post_start_report "final_health_status=${status}"
    append_post_start_report "final_network_status=${network_status}"
    append_post_start_report "final_diagnostics_status=${diagnostics_status}"
    append_post_start_report "completed_at=$(ts)"

    return 0
}

main "$@"
exit 0
