#!/usr/bin/env bash
# =============================================================================
# github-copilot-network-manager.sh — GitHub/Copilot Network Orchestrator
# Version: v1.4.2
#
# Purpose:
#   Runtime-only GitHub/Copilot network manager for DevContainers. Intended to be
#   called by post-start.sh when DEVCONTAINER_ENABLE_COPILOT_NETWORK_MANAGER=true.
#
# Contract:
#   - Does not start application services.
#   - Does not mutate Docker/DevContainer structure.
#   - Delegates the only active route mutation to github-api-route-fix.sh.
#   - Otherwise performs passive endpoint probes and writes report/metrics/status.
#   - Does not expose credentials and does not perform authenticated probes by default.
#   - Keeps historical telemetry locally for stability scoring, without tokens.
#   - Returns non-zero only when api.github.com route-fix fails, when required
#     dependencies are absent, or when explicitly configured to fail on degraded/
#     unstable conditions.
#
# Architecture:
#   post-start.sh
#     -> github-copilot-network-manager.sh
#          -> github-api-route-fix.sh       [active /etc/hosts mutation only for api.github.com]
#          -> passive endpoint probes       [GitHub/Copilot/TAS/GitHub Copilot API]
#          -> current reports/status/metrics [/tmp/devcontainer-copilot-network.*]
#          -> current plane diagnosis         [/tmp/devcontainer-copilot-network.diagnosis.tsv]
#          -> rolling history/analysis        [~/.cache/devcontainer/network/*.tsv]
#
# v1.4.2 focus:
#   - ShellCheck cleanup for SC2015/SC2002 without changing fail-safe semantics
#   - LF-normalized script output for Linux/DevContainer execution
#   - compatibility aliases for local-dns-cache.sh v1.5.0 status/summary files
#   - richer DNS cache v1.5.0 summary ingestion: stale state, ranking, resolv health
#   - compatibility alias for DEVCONTAINER_COPILOT_PROBE_PARALLEL
#   - route-fix report/status/summary/metrics propagation when delegated
#   - safer one-line summary readers and IPv6 loopback proxy URL parsing
#
# Notes:
#   - HTTP 401/403/404 can be healthy for unauthenticated connectivity probes.
#   - This script validates transport shape, TLS, timing and route behavior; it is
#     not a Copilot entitlement/licensing validator.
# =============================================================================

set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

# -----------------------------------------------------------------------------
# Config helpers
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
SCRIPT_NAME="github-copilot-network-manager.sh"
readonly SCRIPT_NAME
SCRIPT_VERSION="1.4.2"
readonly SCRIPT_VERSION

SCRIPT_DIR=""
SCRIPT_DIR_TMP=""
if SCRIPT_DIR_TMP="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2> /dev/null && pwd -P 2> /dev/null)"; then
    SCRIPT_DIR="${SCRIPT_DIR_TMP}"
else
    SCRIPT_DIR="$(pwd -P 2> /dev/null || printf '.')"
fi
readonly SCRIPT_DIR

RUN_ID="$(date '+%Y%m%dT%H%M%S%z' 2> /dev/null)-$$"
readonly RUN_ID

ACTION="${DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION:-start}"
case "${ACTION}" in
    start | status | probe | history | doctor) : ;;
    *) ACTION="start" ;;
esac
readonly ACTION

MANAGER_MODE="${DEVCONTAINER_COPILOT_NETWORK_MANAGER_MODE:-active}"
case "${MANAGER_MODE}" in
    off | disabled | false) MANAGER_MODE="off" ;;
    active | on | true | enabled) MANAGER_MODE="active" ;;
    *) MANAGER_MODE="active" ;;
esac
readonly MANAGER_MODE

GITHUB_API_HOST="${DEVCONTAINER_GITHUB_API_HOST:-api.github.com}"
readonly GITHUB_API_HOST
ALLOW_CUSTOM_GITHUB_API_HOST="$(cfg_bool "${DEVCONTAINER_COPILOT_MANAGER_ALLOW_CUSTOM_GITHUB_API_HOST:-false}" false)"
readonly ALLOW_CUSTOM_GITHUB_API_HOST
GITHUB_API_ROUTE_SCRIPT="${DEVCONTAINER_GITHUB_API_ROUTE_SCRIPT:-${SCRIPT_DIR}/github-api-route-fix.sh}"
readonly GITHUB_API_ROUTE_SCRIPT

RUN_API_ROUTE_FIX="$(cfg_bool "${DEVCONTAINER_COPILOT_MANAGER_RUN_API_ROUTE_FIX:-true}" true)"
readonly RUN_API_ROUTE_FIX
FAIL_ON_DEGRADED="$(cfg_bool "${DEVCONTAINER_COPILOT_MANAGER_FAIL_ON_DEGRADED:-false}" false)"
readonly FAIL_ON_DEGRADED
FAIL_ON_ROUTE_FIX="$(cfg_bool "${DEVCONTAINER_COPILOT_MANAGER_FAIL_ON_ROUTE_FIX:-true}" true)"
readonly FAIL_ON_ROUTE_FIX
FAIL_ON_UNSTABLE="$(cfg_bool "${DEVCONTAINER_COPILOT_MANAGER_FAIL_ON_UNSTABLE:-false}" false)"
readonly FAIL_ON_UNSTABLE
MARK_UNSTABLE_AS_DEGRADED="$(cfg_bool "${DEVCONTAINER_COPILOT_MANAGER_MARK_UNSTABLE_AS_DEGRADED:-false}" false)"
readonly MARK_UNSTABLE_AS_DEGRADED

REPORT_FILE="${DEVCONTAINER_COPILOT_NETWORK_REPORT_FILE:-/tmp/devcontainer-copilot-network.report}"
readonly REPORT_FILE
METRICS_FILE="${DEVCONTAINER_COPILOT_NETWORK_METRICS_FILE:-/tmp/devcontainer-copilot-network.metrics.tsv}"
readonly METRICS_FILE
STATUS_FILE="${DEVCONTAINER_COPILOT_NETWORK_STATUS_FILE:-/tmp/devcontainer-copilot-network.status}"
readonly STATUS_FILE
SUMMARY_FILE="${DEVCONTAINER_COPILOT_NETWORK_SUMMARY_FILE:-/tmp/devcontainer-copilot-network.summary}"
readonly SUMMARY_FILE
DIAGNOSIS_FILE="${DEVCONTAINER_COPILOT_NETWORK_DIAGNOSIS_FILE:-/tmp/devcontainer-copilot-network.diagnosis.tsv}"
readonly DIAGNOSIS_FILE
# local-dns-cache.sh v1.5.0 uses DEVCONTAINER_LOCAL_DNS_STATUS_FILE and
# DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE.  Earlier manager builds used the
# *_CACHE_* names.  Accept both so post-start, post-attach and manual runs read
# the same runtime plane without requiring a synchronized env migration.
LOCAL_DNS_STATUS_FILE="${DEVCONTAINER_LOCAL_DNS_CACHE_STATUS_FILE:-${DEVCONTAINER_LOCAL_DNS_STATUS_FILE:-/tmp/devcontainer-local-dns-cache.status}}"
readonly LOCAL_DNS_STATUS_FILE
LOCAL_DNS_SUMMARY_FILE="${DEVCONTAINER_LOCAL_DNS_CACHE_SUMMARY_FILE:-${DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.summary}}"
readonly LOCAL_DNS_SUMMARY_FILE
GITHUB_ROUTE_REPORT_FILE="${DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE:-/tmp/devcontainer-github-api-route.report}"
readonly GITHUB_ROUTE_REPORT_FILE
GITHUB_ROUTE_STATUS_FILE="${DEVCONTAINER_GITHUB_ROUTE_STATUS_FILE:-/tmp/devcontainer-github-api-route.status}"
readonly GITHUB_ROUTE_STATUS_FILE
GITHUB_ROUTE_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.summary}"
readonly GITHUB_ROUTE_SUMMARY_FILE
GITHUB_ROUTE_METRICS_FILE="${DEVCONTAINER_GITHUB_ROUTE_METRICS_FILE:-/tmp/devcontainer-github-api-route.metrics.tsv}"
readonly GITHUB_ROUTE_METRICS_FILE
LOCK_FILE="${DEVCONTAINER_COPILOT_NETWORK_LOCK_FILE:-/tmp/devcontainer-network/github-copilot-network-manager.lock}"
readonly LOCK_FILE
LOCK_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_COPILOT_NETWORK_LOCK_WAIT_SECONDS:-30}" 30 0 300)"
readonly LOCK_WAIT_SECONDS

HISTORY_ENABLED="$(cfg_bool "${DEVCONTAINER_COPILOT_NETWORK_HISTORY_ENABLED:-true}" true)"
readonly HISTORY_ENABLED
HISTORY_FILE="${DEVCONTAINER_COPILOT_NETWORK_HISTORY_FILE:-${HOME:-/home/node}/.cache/devcontainer/network/copilot-network-history.tsv}"
readonly HISTORY_FILE
HISTORY_ANALYSIS_FILE="${DEVCONTAINER_COPILOT_NETWORK_HISTORY_ANALYSIS_FILE:-/tmp/devcontainer-copilot-network.history.tsv}"
readonly HISTORY_ANALYSIS_FILE
HISTORY_MAX_LINES="$(cfg_uint "${DEVCONTAINER_COPILOT_NETWORK_HISTORY_MAX_LINES:-5000}" 5000 100 100000)"
readonly HISTORY_MAX_LINES
HISTORY_WINDOW="$(cfg_uint "${DEVCONTAINER_COPILOT_NETWORK_HISTORY_WINDOW:-40}" 40 5 500)"
readonly HISTORY_WINDOW
HISTORY_FAIL_THRESHOLD="$(cfg_uint "${DEVCONTAINER_COPILOT_NETWORK_HISTORY_FAIL_THRESHOLD:-2}" 2 1 100)"
readonly HISTORY_FAIL_THRESHOLD
HISTORY_SLOW_THRESHOLD="$(cfg_uint "${DEVCONTAINER_COPILOT_NETWORK_HISTORY_SLOW_THRESHOLD:-5}" 5 1 100)"
readonly HISTORY_SLOW_THRESHOLD
HISTORY_LOCK_FILE="${DEVCONTAINER_COPILOT_NETWORK_HISTORY_LOCK_FILE:-${HISTORY_FILE}.lock}"
readonly HISTORY_LOCK_FILE
HISTORY_LOCK_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_COPILOT_NETWORK_HISTORY_LOCK_WAIT_SECONDS:-10}" 10 0 300)"
readonly HISTORY_LOCK_WAIT_SECONDS

CONNECT_TIMEOUT="$(cfg_uint "${DEVCONTAINER_COPILOT_PROBE_CONNECT_TIMEOUT:-4}" 4 1 60)"
readonly CONNECT_TIMEOUT
MAX_TIME="$(cfg_uint "${DEVCONTAINER_COPILOT_PROBE_MAX_TIME:-12}" 12 2 180)"
readonly MAX_TIME
WARN_TOTAL_MS="$(cfg_uint "${DEVCONTAINER_COPILOT_WARN_TOTAL_MS:-2500}" 2500 0 120000)"
readonly WARN_TOTAL_MS
SUBSCRIPT_TIMEOUT="$(cfg_uint "${DEVCONTAINER_COPILOT_MANAGER_SUBSCRIPT_TIMEOUT_SECONDS:-90}" 90 5 900)"
readonly SUBSCRIPT_TIMEOUT

PROBE_IP_FAMILY="${DEVCONTAINER_COPILOT_PROBE_IP_FAMILY:-4}"
case "${PROBE_IP_FAMILY}" in
    4 | 6 | auto) : ;;
    *) PROBE_IP_FAMILY="4" ;;
esac
readonly PROBE_IP_FAMILY

PROBE_PROXY_MODE="${DEVCONTAINER_COPILOT_PROBE_PROXY_MODE:-auto}"
case "${PROBE_PROXY_MODE}" in
    auto | direct | proxy-aware | local) : ;;
    *) PROBE_PROXY_MODE="auto" ;;
esac
readonly PROBE_PROXY_MODE

LOCAL_PROXY_URL="${DEVCONTAINER_LOCAL_COPILOT_PROXY_URL:-http://127.0.0.1:3128}"
readonly LOCAL_PROXY_URL
ALLOW_NON_LOOPBACK_LOCAL_PROXY="$(cfg_bool "${DEVCONTAINER_COPILOT_MANAGER_ALLOW_NON_LOOPBACK_LOCAL_PROXY:-false}" false)"
readonly ALLOW_NON_LOOPBACK_LOCAL_PROXY

PROBE_PARALLEL="$(cfg_bool "${DEVCONTAINER_COPILOT_MANAGER_PARALLEL_PROBES:-${DEVCONTAINER_COPILOT_PROBE_PARALLEL:-false}}" false)"
readonly PROBE_PARALLEL
PROBE_TMP_DIR="${DEVCONTAINER_COPILOT_MANAGER_PROBE_TMP_DIR:-/tmp}"
readonly PROBE_TMP_DIR
MAX_ENDPOINTS="$(cfg_uint "${DEVCONTAINER_COPILOT_MANAGER_MAX_ENDPOINTS:-32}" 32 1 128)"
readonly MAX_ENDPOINTS
ALLOW_CUSTOM_ENDPOINTS="$(cfg_bool "${DEVCONTAINER_COPILOT_MANAGER_ALLOW_CUSTOM_ENDPOINTS:-false}" false)"
readonly ALLOW_CUSTOM_ENDPOINTS
ENABLE_EXTENDED_ALLOWLIST_PROBES="$(cfg_bool "${DEVCONTAINER_COPILOT_MANAGER_EXTENDED_ALLOWLIST_PROBES:-false}" false)"
readonly ENABLE_EXTENDED_ALLOWLIST_PROBES

DEFAULT_ENDPOINTS="https://api.github.com https://api.github.com/rate_limit https://api.github.com/user https://api.github.com/copilot_internal/v2/token https://copilot-proxy.githubusercontent.com https://default.exp-tas.com https://api.githubcopilot.com https://api.individual.githubcopilot.com https://proxy.individual.githubcopilot.com"
EXTENDED_ENDPOINTS="https://origin-tracker.githubusercontent.com https://copilot-telemetry.githubusercontent.com/telemetry https://collector.github.com"
if [[ "${ENABLE_EXTENDED_ALLOWLIST_PROBES}" == "true" ]]; then
    ENDPOINTS="${DEVCONTAINER_COPILOT_PROBE_ENDPOINTS:-${DEFAULT_ENDPOINTS} ${EXTENDED_ENDPOINTS}}"
else
    ENDPOINTS="${DEVCONTAINER_COPILOT_PROBE_ENDPOINTS:-${DEFAULT_ENDPOINTS}}"
fi
readonly ENDPOINTS

# Global history analysis outputs. Avoid using shell return codes for counts.
HISTORY_STATUS="unknown"
HISTORY_UNSTABLE_HOSTS="0"
HISTORY_WORST_HOST=""
HISTORY_WORST_P95_MS="0"

# Current-run diagnosis outputs. These are derived from current metrics and
# summaries only; they do not trigger repairs or external probes.
DNS_CACHE_STATUS="unknown"
DNS_CACHE_EFFECTIVE="unknown"
DNS_CACHE_REASON="unknown"
DNS_CACHE_RESOLV_CONF_STATUS="unknown"
DNS_CACHE_RESOLV_CONF_HEALTH="unknown"
DNS_CACHE_RESOLV_CONF_NAMESERVERS="unknown"
DNS_CACHE_STATUS_STALE="unknown"
DNS_CACHE_STATUS_STALE_REASON="unknown"
DNS_CACHE_RANKING_SOURCE="unknown"
DNS_CACHE_RANKING_STALE="unknown"
DNS_CACHE_RANKING_REASON="unknown"
DNS_CACHE_SELECTED_UPSTREAMS="unknown"
DNS_CACHE_UPSTREAM_COUNT="0"
DNS_CACHE_DNSMASQ_PROCESS_STATUS="unknown"
DNS_CACHE_DNSMASQ_PORT_STATUS="unknown"
DNS_RESOLV_CONF_NAMESERVER="unknown"
PLANE_GITHUB_API_STATUS="unknown"
PLANE_COPILOT_TRANSPORT_STATUS="unknown"
PLANE_COPILOT_TELEMETRY_STATUS="unknown"
PLANE_OVERALL_STATUS="unknown"
CURRENT_WORST_HOST=""
CURRENT_WORST_TOTAL_MS="0"
PRIMARY_BOTTLENECK="unknown"
RECOMMENDATIONS="observe"
ROUTE_FIX_SUMMARY_ALLOWED="false"
ROUTE_FIX_DECISION="not-run"

# -----------------------------------------------------------------------------
# Logging / report helpers
# -----------------------------------------------------------------------------
ts() { date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date; }

log_info() { printf '%s\n' "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { printf '%s\n' "⚠️  [${SCRIPT_NAME}] $*"; }
log_ok() { printf '%s\n' "✅ [${SCRIPT_NAME}] $*"; }
log_debug() {
    if [[ "${DEVCONTAINER_VERBOSE_NETWORK:-false}" == "true" ]]; then
        printf '%s\n' "🔎 [${SCRIPT_NAME}] $*" >&2
    fi
}

ensure_parent_dir() {
    local path dir
    path="${1:-/tmp/unknown}"
    dir="$(dirname "${path}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${dir}" 2> /dev/null || true
}

safe_write_file() {
    local target mode tmp dir
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
    return 0
}

write_status() {
    local value
    value="${1:-unknown}"
    printf '%s\n' "${value}" | safe_write_file "${STATUS_FILE}" 0644 || true
}

append_report() {
    ensure_parent_dir "${REPORT_FILE}"
    printf '%s\n' "$*" >> "${REPORT_FILE}" 2> /dev/null || true
}

redact_url_credentials() {
    local value
    value="${1:-}"
    printf '%s' "${value}" | sed -E 's#(https?://)[^/@:]+(:[^/@]*)?@#\1***:***@#g' 2> /dev/null || printf '%s' "${value}"
}

write_headers() {
    ensure_parent_dir "${REPORT_FILE}"
    ensure_parent_dir "${METRICS_FILE}"
    ensure_parent_dir "${SUMMARY_FILE}"
    ensure_parent_dir "${DIAGNOSIS_FILE}"
    ensure_parent_dir "${HISTORY_ANALYSIS_FILE}"
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'run_id=%s\n' "${RUN_ID}"
        printf 'action=%s\n' "${ACTION}"
        printf 'mode=%s\n' "${MANAGER_MODE}"
        printf 'github_api_host=%s\n' "${GITHUB_API_HOST}"
        printf 'run_api_route_fix=%s\n' "${RUN_API_ROUTE_FIX}"
        printf 'fail_on_route_fix=%s\n' "${FAIL_ON_ROUTE_FIX}"
        printf 'fail_on_degraded=%s\n' "${FAIL_ON_DEGRADED}"
        printf 'fail_on_unstable=%s\n' "${FAIL_ON_UNSTABLE}"
        printf 'history_enabled=%s\n' "${HISTORY_ENABLED}"
        printf 'history_file=%s\n' "${HISTORY_FILE}"
        printf 'history_window=%s\n' "${HISTORY_WINDOW}"
        printf 'history_lock_wait_seconds=%s\n' "${HISTORY_LOCK_WAIT_SECONDS}"
        printf 'probe_ip_family=%s\n' "${PROBE_IP_FAMILY}"
        printf 'probe_proxy_mode=%s\n' "${PROBE_PROXY_MODE}"
        printf 'local_proxy_url=%s\n' "$(redact_url_credentials "${LOCAL_PROXY_URL}")"
        printf 'parallel_probes=%s\n' "${PROBE_PARALLEL}"
        printf 'local_dns_status_file=%s\n' "${LOCAL_DNS_STATUS_FILE}"
        printf 'local_dns_summary_file=%s\n' "${LOCAL_DNS_SUMMARY_FILE}"
        printf 'github_route_status_file=%s\n' "${GITHUB_ROUTE_STATUS_FILE}"
        printf 'github_route_summary_file=%s\n' "${GITHUB_ROUTE_SUMMARY_FILE}"
        printf 'github_route_metrics_file=%s\n' "${GITHUB_ROUTE_METRICS_FILE}"
        printf 'connect_timeout=%s\n' "${CONNECT_TIMEOUT}"
        printf 'max_time=%s\n' "${MAX_TIME}"
        printf 'warn_total_ms=%s\n' "${WARN_TOTAL_MS}"
        printf '\n'
    } > "${REPORT_FILE}" 2> /dev/null || true

    printf 'timestamp\turl\thost\tclass\texpected\thttp_code\tremote_ip\tdns_ms\ttcp_ms\ttls_ms\tttfb_ms\ttotal_ms\ttls_verify\tcontent_type\tstatus\tnote\tplane\tbottleneck\n' > "${METRICS_FILE}" 2> /dev/null || true
    printf 'plane\tstatus\tendpoints\tok\tslow\tfailures\tworst_host\tworst_total_ms\tprimary_bottleneck\n' > "${DIAGNOSIS_FILE}" 2> /dev/null || true
    printf 'host\trecent_count\tfailures\tslow\tok\tavg_total_ms\tp95_total_ms\tmax_total_ms\tunique_remote_ips\tlast_remote_ip\tlast_status\tstatus\n' > "${HISTORY_ANALYSIS_FILE}" 2> /dev/null || true
    : > "${SUMMARY_FILE}" 2> /dev/null || true
    write_status "running"
}

sanitize_oneline() {
    # Summary/status files are machine generated, but sanitize before putting
    # values back into human logs or key=value reports.  Preserve spaces because
    # fields such as selected_upstreams intentionally contain a list.
    LC_ALL=C awk 'NR == 1 { gsub(/\r/, ""); gsub(/[[:cntrl:]]/, ""); print; exit }' 2> /dev/null
}

read_first_line() {
    local file fallback value
    file="${1:-}"
    fallback="${2:-}"
    if [[ -r "${file}" ]]; then
        value="$(head -n 1 "${file}" 2> /dev/null | sanitize_oneline)"
        printf '%s' "${value:-${fallback}}"
        return 0
    fi
    printf '%s' "${fallback}"
}

summary_value_from_file() {
    local file key
    file="${1:-}"
    key="${2:-}"
    [[ -r "${file}" && -n "${key}" ]] || return 0
    awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}' "${file}" 2> /dev/null | sanitize_oneline
}

first_nameserver_from_resolv_conf() {
    awk '$1 == "nameserver" {print $2; exit}' /etc/resolv.conf 2> /dev/null || printf 'unknown'
}

join_recommendation() {
    # Append a recommendation token to a comma-separated recommendation string.
    # Duplicate tokens are ignored.
    local current token
    current="${1:-}"
    token="${2:-}"
    [[ -n "${token}" ]] || {
        printf '%s' "${current:-observe}"
        return 0
    }
    case ",${current}," in
        *,"${token}",*) printf '%s' "${current}" ;;
        ,, | ,observe,) printf '%s' "${token}" ;;
        *) printf '%s,%s' "${current}" "${token}" ;;
    esac
}

write_summary() {
    local route_rc probes_rc failures slow ok total status history_status unstable_hosts route_status route_selected route_current route_latency
    route_rc="${1:-0}"
    probes_rc="${2:-0}"
    failures="${3:-0}"
    slow="${4:-0}"
    ok="${5:-0}"
    total="${6:-0}"
    status="${7:-unknown}"
    history_status="${8:-unknown}"
    unstable_hosts="${9:-0}"

    if [[ "${ROUTE_FIX_SUMMARY_ALLOWED}" == "true" ]]; then
        route_status="$(summary_value_from_file "${GITHUB_ROUTE_SUMMARY_FILE}" status)"
        route_selected="$(summary_value_from_file "${GITHUB_ROUTE_SUMMARY_FILE}" selected_ip)"
        route_current="$(summary_value_from_file "${GITHUB_ROUTE_SUMMARY_FILE}" current_ip)"
        route_latency="$(summary_value_from_file "${GITHUB_ROUTE_SUMMARY_FILE}" selected_latency_ms)"
    else
        route_status="${ROUTE_FIX_DECISION:-skipped}"
        route_selected="unknown"
        route_current="unknown"
        route_latency="unknown"
    fi

    ensure_parent_dir "${SUMMARY_FILE}"
    {
        printf 'status=%s\n' "${status}"
        printf 'history_status=%s\n' "${history_status}"
        printf 'unstable_hosts=%s\n' "${unstable_hosts}"
        printf 'history_worst_host=%s\n' "${HISTORY_WORST_HOST}"
        printf 'history_worst_p95_ms=%s\n' "${HISTORY_WORST_P95_MS}"
        printf 'route_rc=%s\n' "${route_rc}"
        printf 'route_status=%s\n' "${route_status:-unknown}"
        printf 'route_selected_ip=%s\n' "${route_selected:-unknown}"
        printf 'route_current_ip=%s\n' "${route_current:-unknown}"
        printf 'route_selected_latency_ms=%s\n' "${route_latency:-unknown}"
        printf 'dns_cache_status=%s\n' "${DNS_CACHE_STATUS}"
        printf 'dns_cache_effective=%s\n' "${DNS_CACHE_EFFECTIVE}"
        printf 'dns_cache_reason=%s\n' "${DNS_CACHE_REASON}"
        printf 'dns_cache_resolv_conf_status=%s\n' "${DNS_CACHE_RESOLV_CONF_STATUS}"
        printf 'dns_cache_resolv_conf_health=%s\n' "${DNS_CACHE_RESOLV_CONF_HEALTH}"
        printf 'dns_cache_resolv_conf_nameservers=%s\n' "${DNS_CACHE_RESOLV_CONF_NAMESERVERS}"
        printf 'dns_cache_status_stale=%s\n' "${DNS_CACHE_STATUS_STALE}"
        printf 'dns_cache_status_stale_reason=%s\n' "${DNS_CACHE_STATUS_STALE_REASON}"
        printf 'dns_cache_ranking_source=%s\n' "${DNS_CACHE_RANKING_SOURCE}"
        printf 'dns_cache_ranking_stale=%s\n' "${DNS_CACHE_RANKING_STALE}"
        printf 'dns_cache_ranking_reason=%s\n' "${DNS_CACHE_RANKING_REASON}"
        printf 'dns_cache_selected_upstreams=%s\n' "${DNS_CACHE_SELECTED_UPSTREAMS}"
        printf 'dns_cache_upstream_count=%s\n' "${DNS_CACHE_UPSTREAM_COUNT}"
        printf 'dns_cache_dnsmasq_process_status=%s\n' "${DNS_CACHE_DNSMASQ_PROCESS_STATUS}"
        printf 'dns_cache_dnsmasq_port_status=%s\n' "${DNS_CACHE_DNSMASQ_PORT_STATUS}"
        printf 'dns_resolv_conf_nameserver=%s\n' "${DNS_RESOLV_CONF_NAMESERVER}"
        printf 'plane_overall_status=%s\n' "${PLANE_OVERALL_STATUS}"
        printf 'plane_github_api_status=%s\n' "${PLANE_GITHUB_API_STATUS}"
        printf 'plane_copilot_transport_status=%s\n' "${PLANE_COPILOT_TRANSPORT_STATUS}"
        printf 'plane_copilot_telemetry_status=%s\n' "${PLANE_COPILOT_TELEMETRY_STATUS}"
        printf 'current_worst_host=%s\n' "${CURRENT_WORST_HOST:-unknown}"
        printf 'current_worst_total_ms=%s\n' "${CURRENT_WORST_TOTAL_MS:-0}"
        printf 'primary_bottleneck=%s\n' "${PRIMARY_BOTTLENECK:-unknown}"
        printf 'recommendations=%s\n' "${RECOMMENDATIONS:-observe}"
        printf 'diagnosis=%s\n' "${DIAGNOSIS_FILE}"
        printf 'probes_rc=%s\n' "${probes_rc}"
        printf 'endpoints_total=%s\n' "${total}"
        printf 'endpoints_ok=%s\n' "${ok}"
        printf 'endpoints_slow=%s\n' "${slow}"
        printf 'endpoints_failed=%s\n' "${failures}"
        printf 'report=%s\n' "${REPORT_FILE}"
        printf 'metrics=%s\n' "${METRICS_FILE}"
        printf 'history=%s\n' "${HISTORY_FILE}"
        printf 'history_analysis=%s\n' "${HISTORY_ANALYSIS_FILE}"
        printf 'github_route_report=%s\n' "${GITHUB_ROUTE_REPORT_FILE}"
        printf 'github_route_summary=%s\n' "${GITHUB_ROUTE_SUMMARY_FILE}"
        printf 'completed_at=%s\n' "$(ts)"
    } | safe_write_file "${SUMMARY_FILE}" 0644 || true
}

# -----------------------------------------------------------------------------
# Generic helpers
# -----------------------------------------------------------------------------
has_cmd() { command -v "$1" > /dev/null 2>&1; }

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

extract_field() {
    local key line
    key="$1"
    line="$2"
    printf '%s' "${line}" | tr '|' '\n' | awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}'
}

float_ms() {
    local value
    value="${1:-0}"
    value="${value/,/.}"
    LC_ALL=C awk -v s="${value}" 'BEGIN { if (s == "") s=0; printf "%d", s*1000 }' 2> /dev/null
}

nonneg_diff_ms() {
    local upper lower diff
    upper="${1:-0}"
    lower="${2:-0}"
    [[ "${upper}" =~ ^[0-9]+$ ]] || upper=0
    [[ "${lower}" =~ ^[0-9]+$ ]] || lower=0
    diff=$((upper - lower))
    if ((diff < 0)); then
        diff=0
    fi
    printf '%s' "${diff}"
}

dominant_bottleneck() {
    local dns_ms tcp_cum_ms tls_cum_ms ttfb_cum_ms total_ms status
    local tcp_phase_ms tls_phase_ms server_phase_ms transfer_phase_ms max_phase label
    dns_ms="${1:-0}"
    tcp_cum_ms="${2:-0}"
    tls_cum_ms="${3:-0}"
    ttfb_cum_ms="${4:-0}"
    total_ms="${5:-0}"
    status="${6:-ok}"

    [[ "${dns_ms}" =~ ^[0-9]+$ ]] || dns_ms=0
    [[ "${tcp_cum_ms}" =~ ^[0-9]+$ ]] || tcp_cum_ms=0
    [[ "${tls_cum_ms}" =~ ^[0-9]+$ ]] || tls_cum_ms=0
    [[ "${ttfb_cum_ms}" =~ ^[0-9]+$ ]] || ttfb_cum_ms=0
    [[ "${total_ms}" =~ ^[0-9]+$ ]] || total_ms=0

    case "${status}" in
        fail | tls-fail | unexpected-http)
            printf 'transport-failure'
            return 0
            ;;
    esac

    if ((total_ms <= 0)); then
        printf 'unknown'
        return 0
    fi

    tcp_phase_ms="$(nonneg_diff_ms "${tcp_cum_ms}" "${dns_ms}")"
    if ((tls_cum_ms > 0)); then
        tls_phase_ms="$(nonneg_diff_ms "${tls_cum_ms}" "${tcp_cum_ms}")"
        server_phase_ms="$(nonneg_diff_ms "${ttfb_cum_ms}" "${tls_cum_ms}")"
    else
        tls_phase_ms=0
        server_phase_ms="$(nonneg_diff_ms "${ttfb_cum_ms}" "${tcp_cum_ms}")"
    fi
    transfer_phase_ms="$(nonneg_diff_ms "${total_ms}" "${ttfb_cum_ms}")"

    max_phase="${dns_ms}"
    label="dns-bound"
    if ((tcp_phase_ms > max_phase)); then
        max_phase="${tcp_phase_ms}"
        label="tcp-bound"
    fi
    if ((tls_phase_ms > max_phase)); then
        max_phase="${tls_phase_ms}"
        label="tls-bound"
    fi
    if ((server_phase_ms > max_phase)); then
        max_phase="${server_phase_ms}"
        label="server-bound"
    fi
    if ((transfer_phase_ms > max_phase)); then
        max_phase="${transfer_phase_ms}"
        label="transfer-bound"
    fi

    if ((max_phase < 25)); then
        label="low-latency"
    fi
    printf '%s' "${label}"
}

url_host() {
    local url no_proto host
    url="$1"
    no_proto="${url#*://}"
    host="${no_proto%%/*}"
    # All canonical endpoints are hostnames. Ports are not allowed by is_safe_https_url.
    host="${host%%:*}"
    printf '%s' "${host}"
}

is_safe_hostname() {
    local h label old_ifs
    h="${1:-}"
    [[ ${#h} -ge 1 && ${#h} -le 253 ]] || return 1
    [[ "${h}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] || return 1
    [[ "${h}" != *..* ]] || return 1
    [[ "${h}" == *.* ]] || return 1
    old_ifs="${IFS}"
    IFS='.'
    for label in ${h}; do
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

is_allowed_probe_host() {
    local host
    host="$(lowercase "${1:-}")"

    if [[ "${ALLOW_CUSTOM_ENDPOINTS}" == "true" ]]; then
        return 0
    fi

    if [[ "${host}" == "api.github.com" ]]; then return 0; fi
    if [[ "${host}" == "copilot-proxy.githubusercontent.com" ]]; then return 0; fi
    if [[ "${host}" == "origin-tracker.githubusercontent.com" ]]; then return 0; fi
    if [[ "${host}" == "copilot-telemetry.githubusercontent.com" ]]; then return 0; fi
    if [[ "${host}" == "collector.github.com" ]]; then return 0; fi
    if [[ "${host}" == "default.exp-tas.com" ]]; then return 0; fi
    if [[ "${host}" == *.githubcopilot.com ]]; then return 0; fi
    return 1
}

is_safe_https_url() {
    local url host no_proto hostport
    url="${1:-}"
    [[ "${url}" == https://* ]] || return 1
    [[ "${url}" != *$'\n'* && "${url}" != *$'\r'* && "${url}" != *$'\t'* ]] || return 1
    no_proto="${url#https://}"
    hostport="${no_proto%%/*}"
    # Canonical endpoint probes do not use custom ports. This avoids ambiguous parsing.
    [[ "${hostport}" != *:* ]] || return 1
    host="$(url_host "${url}")"
    is_safe_hostname "${host}" || return 1
    is_allowed_probe_host "${host}" || return 1
    return 0
}

is_loopback_proxy_url() {
    local url without_scheme hostport host port
    url="${1:-}"
    [[ "${url}" == http://* ]] || return 1
    without_scheme="${url#http://}"
    [[ "${without_scheme}" != *"@"* ]] || return 1
    hostport="${without_scheme%%/*}"
    if [[ "${hostport}" == \[*\]:* ]]; then
        host="${hostport%%]:*}]"
        port="${hostport##*:}"
    else
        host="${hostport%%:*}"
        port="${hostport##*:}"
    fi
    [[ "${host}" == "127."* || "${host}" == "localhost" || "${host}" == "[::1]" ]] || return 1
    [[ "${port}" =~ ^[0-9]+$ && "${port}" -ge 1 && "${port}" -le 65535 ]] || return 1
    return 0
}

has_proxy_env() {
    [[ -n "${HTTPS_PROXY:-}${https_proxy:-}${HTTP_PROXY:-}${http_proxy:-}${ALL_PROXY:-}${all_proxy:-}" ]]
}

curl_family_arg() {
    case "${PROBE_IP_FAMILY}" in
        4) printf -- '-4' ;;
        6) printf -- '-6' ;;
        *) printf '' ;;
    esac
}

build_curl_args() {
    local family_arg
    family_arg="$(curl_family_arg)"
    if [[ -n "${family_arg}" ]]; then
        printf '%s\n' "${family_arg}"
    fi

    case "${PROBE_PROXY_MODE}" in
        direct)
            printf '%s\n' '--noproxy'
            printf '%s\n' '*'
            ;;
        local)
            if is_loopback_proxy_url "${LOCAL_PROXY_URL}" || [[ "${ALLOW_NON_LOOPBACK_LOCAL_PROXY}" == "true" ]]; then
                printf '%s\n' '--proxy'
                printf '%s\n' "${LOCAL_PROXY_URL}"
            else
                printf '%s\n' '--noproxy'
                printf '%s\n' '*'
            fi
            ;;
        proxy-aware | auto)
            :
            ;;
    esac
}

endpoint_class() {
    local url host
    url="$1"
    host="$(lowercase "$(url_host "${url}")")"

    if [[ "${url}" == "https://api.github.com" || "${url}" == "https://api.github.com/" ]]; then
        printf 'github-api-root'
    elif [[ "${url}" == https://api.github.com/rate_limit* ]]; then
        printf 'github-api-rate-limit'
    elif [[ "${url}" == https://api.github.com/user* ]]; then
        printf 'github-api-user'
    elif [[ "${url}" == https://api.github.com/copilot_internal/* ]]; then
        printf 'github-api-copilot-internal'
    elif [[ "${host}" == "copilot-proxy.githubusercontent.com" ]]; then
        printf 'copilot-proxy'
    elif [[ "${host}" == "origin-tracker.githubusercontent.com" ]]; then
        printf 'copilot-origin-tracker'
    elif [[ "${host}" == "copilot-telemetry.githubusercontent.com" ]]; then
        printf 'copilot-telemetry'
    elif [[ "${host}" == "collector.github.com" ]]; then
        printf 'github-collector-telemetry'
    elif [[ "${host}" == "default.exp-tas.com" ]]; then
        printf 'copilot-telemetry-exp-tas'
    elif [[ "${host}" == "api.githubcopilot.com" ]]; then
        printf 'copilot-api'
    elif [[ "${host}" == "api.individual.githubcopilot.com" ]]; then
        printf 'copilot-individual-api'
    elif [[ "${host}" == "proxy.individual.githubcopilot.com" ]]; then
        printf 'copilot-individual-proxy'
    elif [[ "${host}" == *.business.githubcopilot.com ]]; then
        printf 'copilot-business'
    elif [[ "${host}" == *.enterprise.githubcopilot.com ]]; then
        printf 'copilot-enterprise'
    elif [[ "${host}" == *.githubcopilot.com ]]; then
        printf 'copilot-generic'
    else
        printf 'generic-https'
    fi
}

endpoint_plane() {
    local url host klass
    url="$1"
    host="$(lowercase "$(url_host "${url}")")"
    klass="$(endpoint_class "${url}")"

    case "${klass}" in
        github-api-root | github-api-rate-limit | github-api-user)
            printf 'github-api'
            ;;
        github-api-copilot-internal)
            printf 'copilot-token'
            ;;
        copilot-telemetry-exp-tas | copilot-telemetry | github-collector-telemetry | copilot-origin-tracker)
            printf 'copilot-telemetry'
            ;;
        copilot-proxy | copilot-individual-proxy)
            printf 'copilot-proxy'
            ;;
        copilot-api | copilot-individual-api | copilot-business | copilot-enterprise | copilot-generic)
            printf 'copilot-api'
            ;;
        *)
            if [[ "${host}" == "api.github.com" ]]; then
                printf 'github-api'
            else
                printf 'other'
            fi
            ;;
    esac
}

expected_status_label() {
    local url host
    url="$1"
    host="$(lowercase "$(url_host "${url}")")"

    if [[ "${url}" == "https://api.github.com" || "${url}" == "https://api.github.com/" ]]; then
        printf '200'
    elif [[ "${url}" == https://api.github.com/rate_limit* ]]; then
        printf '200'
    elif [[ "${url}" == https://api.github.com/user* ]]; then
        printf '200|401|403'
    elif [[ "${url}" == https://api.github.com/copilot_internal/* ]]; then
        printf '200|401|403|404'
    elif [[ "${host}" == "copilot-proxy.githubusercontent.com" ||
        "${host}" == "origin-tracker.githubusercontent.com" ||
        "${host}" == "copilot-telemetry.githubusercontent.com" ||
        "${host}" == "collector.github.com" ||
        "${host}" == "default.exp-tas.com" ||
        "${host}" == *.githubcopilot.com ]]; then
        printf '200|204|400|401|403|404|405'
    else
        printf 'nonzero-http'
    fi
}

expected_status_ok() {
    local url code host
    url="$1"
    code="$2"
    host="$(lowercase "$(url_host "${url}")")"

    if [[ "${url}" == "https://api.github.com" || "${url}" == "https://api.github.com/" ]]; then
        [[ "${code}" == "200" ]]
    elif [[ "${url}" == https://api.github.com/rate_limit* ]]; then
        [[ "${code}" == "200" ]]
    elif [[ "${url}" == https://api.github.com/user* ]]; then
        [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]
    elif [[ "${url}" == https://api.github.com/copilot_internal/* ]]; then
        [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" || "${code}" == "404" ]]
    elif [[ "${host}" == "copilot-proxy.githubusercontent.com" ||
        "${host}" == "origin-tracker.githubusercontent.com" ||
        "${host}" == "copilot-telemetry.githubusercontent.com" ||
        "${host}" == "collector.github.com" ||
        "${host}" == "default.exp-tas.com" ||
        "${host}" == *.githubcopilot.com ]]; then
        [[ "${code}" == "200" || "${code}" == "204" || "${code}" == "400" || "${code}" == "401" || "${code}" == "403" || "${code}" == "404" || "${code}" == "405" ]]
    else
        [[ -n "${code}" && "${code}" != "000" ]]
    fi
}

# -----------------------------------------------------------------------------
# Active api.github.com route fix delegation
# -----------------------------------------------------------------------------
run_api_route_fix() {
    [[ "${RUN_API_ROUTE_FIX}" == "true" ]] || {
        ROUTE_FIX_SUMMARY_ALLOWED="false"
        ROUTE_FIX_DECISION="skipped-disabled"
        append_report "api_route_fix=skipped"
        return 0
    }

    if [[ "${GITHUB_API_HOST}" != "api.github.com" && "${ALLOW_CUSTOM_GITHUB_API_HOST}" != "true" ]]; then
        ROUTE_FIX_SUMMARY_ALLOWED="false"
        ROUTE_FIX_DECISION="blocked-custom-host"
        log_warn "GITHUB_API_HOST customizado recusado: ${GITHUB_API_HOST}. Este manager é canônico para api.github.com."
        append_report "api_route_fix=blocked-custom-host host=${GITHUB_API_HOST}"
        return 1
    fi

    if [[ ! -f "${GITHUB_API_ROUTE_SCRIPT}" ]]; then
        ROUTE_FIX_SUMMARY_ALLOWED="false"
        ROUTE_FIX_DECISION="missing"
        log_warn "route-fix script ausente: ${GITHUB_API_ROUTE_SCRIPT}"
        append_report "api_route_fix=missing script=${GITHUB_API_ROUTE_SCRIPT}"
        return 1
    fi

    ROUTE_FIX_SUMMARY_ALLOWED="true"
    ROUTE_FIX_DECISION="executed"
    log_info "Executando route-fix de ${GITHUB_API_HOST}: ${GITHUB_API_ROUTE_SCRIPT}"
    DEVCONTAINER_GITHUB_API_HOST="${GITHUB_API_HOST}" \
        DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE="${GITHUB_ROUTE_REPORT_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_STATUS_FILE="${GITHUB_ROUTE_STATUS_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE="${GITHUB_ROUTE_SUMMARY_FILE}" \
        DEVCONTAINER_GITHUB_ROUTE_METRICS_FILE="${GITHUB_ROUTE_METRICS_FILE}" \
        run_with_timeout "${SUBSCRIPT_TIMEOUT}" bash "${GITHUB_API_ROUTE_SCRIPT}"
    return $?
}

# -----------------------------------------------------------------------------
# Endpoint probes
# -----------------------------------------------------------------------------
emit_probe_record() {
    local url metrics_file report_file log_file result http_code ctype time_name time_connect time_tls time_start time_total remote_ip tls_verify
    local dns_ms tcp_ms tls_ms ttfb_ms total_ms status note host klass expected arg curl_rc plane bottleneck
    local -a curl_args=()

    url="${1:-}"
    metrics_file="${2:-${METRICS_FILE}}"
    report_file="${3:-${REPORT_FILE}}"
    log_file="${4:-/dev/null}"

    if ! is_safe_https_url "${url}"; then
        host="$(url_host "${url}")"
        [[ -n "${host}" ]] || host="unknown"
        klass="invalid-url"
        expected="official-copilot-https-url"
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$(ts)" "${url}" "${host}" "${klass}" "${expected}" "000" "unknown" \
            "0" "0" "0" "0" "0" "?" "none" "fail" "invalid-or-not-allowlisted-url" "other" "transport-failure" \
            >> "${metrics_file}" 2> /dev/null || true
        printf '%s\n' "probe url=${url} status=fail note=invalid-or-not-allowlisted-url" >> "${report_file}" 2> /dev/null || true
        printf '%s\n' "⚠️  [${SCRIPT_NAME}] probe fail: URL inválida ou fora da allowlist canônica: ${url}" >> "${log_file}" 2> /dev/null || true
        return 1
    fi

    while IFS= read -r arg; do
        [[ -n "${arg}" ]] && curl_args+=("${arg}")
    done < <(build_curl_args)

    result="$(LC_ALL=C curl "${curl_args[@]}" -sS -o /dev/null \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_namelookup=%{time_namelookup}|time_connect=%{time_connect}|time_appconnect=%{time_appconnect}|time_starttransfer=%{time_starttransfer}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}|exitcode=%{exitcode}' \
        "${url}" 2> /dev/null)"
    curl_rc=$?

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
    host="$(url_host "${url}")"
    klass="$(endpoint_class "${url}")"
    expected="$(expected_status_label "${url}")"
    status="ok"
    note="ok"

    if [[ "${curl_rc}" -ne 0 && (-z "${http_code}" || "${http_code}" == "000") ]]; then
        status="fail"
        note="curl-rc=${curl_rc}"
    elif [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
        status="fail"
        note="no-http-response"
    elif [[ "${tls_verify}" != "0" ]]; then
        status="tls-fail"
        note="tls-verify=${tls_verify:-?}"
    elif ! expected_status_ok "${url}" "${http_code}"; then
        status="unexpected-http"
        note="expected=${expected}"
    elif [[ "${WARN_TOTAL_MS}" -gt 0 && "${total_ms}" =~ ^[0-9]+$ && "${total_ms}" -gt "${WARN_TOTAL_MS}" ]]; then
        status="slow"
        note="total>${WARN_TOTAL_MS}ms"
    fi

    plane="$(endpoint_plane "${url}")"
    bottleneck="$(dominant_bottleneck "${dns_ms}" "${tcp_ms}" "${tls_ms}" "${ttfb_ms}" "${total_ms}" "${status}")"

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$(ts)" "${url}" "${host}" "${klass}" "${expected}" "${http_code:-000}" "${remote_ip:-unknown}" \
        "${dns_ms}" "${tcp_ms}" "${tls_ms}" "${ttfb_ms}" "${total_ms}" "${tls_verify:-?}" "${ctype:-none}" "${status}" "${note}" "${plane}" "${bottleneck}" \
        >> "${metrics_file}" 2> /dev/null || true

    printf '%s\n' "probe url=${url} class=${klass} plane=${plane} http=${http_code:-000} remote_ip=${remote_ip:-unknown} dns_ms=${dns_ms} tcp_ms=${tcp_ms} tls_ms=${tls_ms} ttfb_ms=${ttfb_ms} total_ms=${total_ms} tls_verify=${tls_verify:-?} status=${status} note=${note} bottleneck=${bottleneck}" \
        >> "${report_file}" 2> /dev/null || true

    case "${status}" in
        ok)
            printf '%s\n' "✅ [${SCRIPT_NAME}] probe OK: ${url} → HTTP ${http_code} | IP ${remote_ip:-unknown} | total ${total_ms}ms" >> "${log_file}" 2> /dev/null || true
            return 0
            ;;
        slow)
            printf '%s\n' "⚠️  [${SCRIPT_NAME}] probe LENTO: ${url} → HTTP ${http_code} | IP ${remote_ip:-unknown} | total ${total_ms}ms" >> "${log_file}" 2> /dev/null || true
            return 2
            ;;
        *)
            printf '%s\n' "⚠️  [${SCRIPT_NAME}] probe ${status}: ${url} → HTTP ${http_code:-000} | IP ${remote_ip:-unknown} | note=${note}" >> "${log_file}" 2> /dev/null || true
            return 1
            ;;
    esac
}

PROBES_FAILURES=0
PROBES_SLOW=0
PROBES_OK=0
PROBES_TOTAL=0

reset_probe_counters() {
    PROBES_FAILURES=0
    PROBES_SLOW=0
    PROBES_OK=0
    PROBES_TOTAL=0
}

count_probe_rc() {
    local rc
    rc="${1:-1}"
    PROBES_TOTAL=$((PROBES_TOTAL + 1))
    if [[ "${rc}" -eq 0 ]]; then
        PROBES_OK=$((PROBES_OK + 1))
    elif [[ "${rc}" -eq 2 ]]; then
        PROBES_SLOW=$((PROBES_SLOW + 1))
    else
        PROBES_FAILURES=$((PROBES_FAILURES + 1))
    fi
}

make_temp_dir() {
    local prefix dir tmp
    prefix="${1:-tmp}"
    dir="${2:-/tmp}"
    tmp=""
    mkdir -p "${dir}" 2> /dev/null || dir="/tmp"
    tmp="$(mktemp -d "${dir%/}/${prefix}.XXXXXX" 2> /dev/null || true)"
    if [[ -n "${tmp}" ]]; then
        printf '%s\n' "${tmp}"
        return 0
    fi
    mktemp -d "/tmp/${prefix}.XXXXXX" 2> /dev/null || true
}

probe_all_endpoints_sequential() {
    local url rc count log_file
    count=0
    log_file="$(mktemp /tmp/copilot-probe-log.XXXXXX 2> /dev/null || true)"
    [[ -n "${log_file}" ]] || log_file="/dev/null"

    for url in ${ENDPOINTS}; do
        count=$((count + 1))
        if ((count > MAX_ENDPOINTS)); then
            append_report "endpoint_limit_reached max=${MAX_ENDPOINTS}"
            break
        fi
        : > "${log_file}" 2> /dev/null || true
        emit_probe_record "${url}" "${METRICS_FILE}" "${REPORT_FILE}" "${log_file}"
        rc=$?
        if [[ -r "${log_file}" ]]; then
            cat "${log_file}" 2> /dev/null || true
        fi
        count_probe_rc "${rc}"
    done

    if [[ "${log_file}" != "/dev/null" ]]; then
        rm -f "${log_file}" 2> /dev/null || true
    fi
}

probe_all_endpoints_parallel() {
    local tmp_dir url count pid rc file metrics_part report_part log_part
    local -a files=() pids=()
    count=0

    tmp_dir="$(make_temp_dir copilot-probes "${PROBE_TMP_DIR}")"
    if [[ -z "${tmp_dir}" || ! -d "${tmp_dir}" ]]; then
        append_report "parallel=fallback-no-tempdir"
        probe_all_endpoints_sequential
        return 0
    fi

    for url in ${ENDPOINTS}; do
        count=$((count + 1))
        if ((count > MAX_ENDPOINTS)); then
            append_report "endpoint_limit_reached max=${MAX_ENDPOINTS}"
            break
        fi
        file="${tmp_dir}/probe.${count}"
        metrics_part="${file}.metrics"
        report_part="${file}.report"
        log_part="${file}.log"
        (
            emit_probe_record "${url}" "${metrics_part}" "${report_part}" "${log_part}"
            printf '%s\n' "$?" > "${file}.rc"
        ) &
        pid=$!
        pids+=("${pid}")
        files+=("${file}")
    done

    for pid in "${pids[@]}"; do
        wait "${pid}" 2> /dev/null || true
    done

    for file in "${files[@]}"; do
        metrics_part="${file}.metrics"
        report_part="${file}.report"
        log_part="${file}.log"
        if [[ -r "${metrics_part}" ]]; then
            cat "${metrics_part}" >> "${METRICS_FILE}" 2> /dev/null || true
        fi
        if [[ -r "${report_part}" ]]; then
            cat "${report_part}" >> "${REPORT_FILE}" 2> /dev/null || true
        fi
        if [[ -r "${log_part}" ]]; then
            cat "${log_part}" 2> /dev/null || true
        fi
        if [[ -r "${file}.rc" ]]; then
            rc="$(read_first_line "${file}.rc" "1")"
        else
            rc=1
        fi
        case "${rc}" in
            0 | 1 | 2) : ;;
            *) rc=1 ;;
        esac
        count_probe_rc "${rc}"
    done

    rm -rf "${tmp_dir}" 2> /dev/null || true
}

probe_all_endpoints() {
    if ! has_cmd curl; then
        log_warn "curl não encontrado; probes indisponíveis."
        append_report "result=no-curl"
        write_status "degraded"
        PROBES_FAILURES=1
        PROBES_SLOW=0
        PROBES_OK=0
        PROBES_TOTAL=0
        return 1
    fi

    reset_probe_counters

    if [[ "${PROBE_PROXY_MODE}" == "local" ]]; then
        if is_loopback_proxy_url "${LOCAL_PROXY_URL}" || [[ "${ALLOW_NON_LOOPBACK_LOCAL_PROXY}" == "true" ]]; then
            append_report "proxy_mode=local proxy_url=$(redact_url_credentials "${LOCAL_PROXY_URL}")"
        else
            log_warn "proxy local recusado por segurança: $(redact_url_credentials "${LOCAL_PROXY_URL}")"
            append_report "proxy_mode=local unsafe_proxy_url=$(redact_url_credentials "${LOCAL_PROXY_URL}")"
            write_status "degraded"
            PROBES_FAILURES=1
            return 1
        fi
    elif [[ "${PROBE_PROXY_MODE}" != "direct" ]] && has_proxy_env; then
        append_report "proxy_env=present mode=${PROBE_PROXY_MODE}"
    else
        append_report "proxy_env=absent_or_direct mode=${PROBE_PROXY_MODE}"
    fi

    if [[ "${PROBE_PARALLEL}" == "true" ]]; then
        append_report "probes=parallel"
        probe_all_endpoints_parallel
    else
        append_report "probes=sequential"
        probe_all_endpoints_sequential
    fi

    append_report "summary failures=${PROBES_FAILURES} slow=${PROBES_SLOW} ok=${PROBES_OK} total=${PROBES_TOTAL}"

    if [[ "${PROBES_FAILURES}" -gt 0 ]]; then
        write_status "degraded"
        return 1
    fi
    if [[ "${PROBES_SLOW}" -gt 0 ]]; then
        write_status "degraded"
        return 2
    fi

    write_status "ok"
    return 0
}

# -----------------------------------------------------------------------------
# Current-run diagnosis / recommendation layer
# -----------------------------------------------------------------------------
plane_status_from_counts() {
    local endpoints failures slow
    endpoints="${1:-0}"
    failures="${2:-0}"
    slow="${3:-0}"
    if ((endpoints <= 0)); then
        printf 'unknown'
    elif ((failures > 0)); then
        printf 'failed'
    elif ((slow > 0)); then
        printf 'degraded'
    else
        printf 'ok'
    fi
}

reset_current_diagnosis() {
    DNS_CACHE_STATUS="unknown"
    DNS_CACHE_EFFECTIVE="unknown"
    DNS_CACHE_REASON="unknown"
    DNS_CACHE_RESOLV_CONF_STATUS="unknown"
    DNS_CACHE_RESOLV_CONF_HEALTH="unknown"
    DNS_CACHE_RESOLV_CONF_NAMESERVERS="unknown"
    DNS_CACHE_STATUS_STALE="unknown"
    DNS_CACHE_STATUS_STALE_REASON="unknown"
    DNS_CACHE_RANKING_SOURCE="unknown"
    DNS_CACHE_RANKING_STALE="unknown"
    DNS_CACHE_RANKING_REASON="unknown"
    DNS_CACHE_SELECTED_UPSTREAMS="unknown"
    DNS_CACHE_UPSTREAM_COUNT="0"
    DNS_CACHE_DNSMASQ_PROCESS_STATUS="unknown"
    DNS_CACHE_DNSMASQ_PORT_STATUS="unknown"
    DNS_RESOLV_CONF_NAMESERVER="unknown"
    PLANE_GITHUB_API_STATUS="unknown"
    PLANE_COPILOT_TRANSPORT_STATUS="unknown"
    PLANE_COPILOT_TELEMETRY_STATUS="unknown"
    PLANE_OVERALL_STATUS="unknown"
    CURRENT_WORST_HOST=""
    CURRENT_WORST_TOTAL_MS="0"
    PRIMARY_BOTTLENECK="unknown"
    RECOMMENDATIONS="observe"
}

detect_dns_cache_state() {
    local local_status summary_status local_reason local_resolv local_resolv_health local_nameservers
    local status_stale status_stale_reason ranking_source ranking_stale ranking_reason selected_upstreams upstream_count
    local dnsmasq_process_status dnsmasq_port_status nameserver zero_dns total_dns active_by_resolv

    local_status="$(read_first_line "${LOCAL_DNS_STATUS_FILE}" "")"
    summary_status="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" status)"
    if [[ -z "${local_status}" ]]; then
        local_status="${summary_status}"
    fi
    local_reason="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" reason)"
    local_resolv="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" resolv_conf_status)"
    local_resolv_health="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" resolv_conf_health)"
    local_nameservers="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" resolv_conf_nameservers)"
    status_stale="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" status_stale)"
    status_stale_reason="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" status_stale_reason)"
    ranking_source="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" ranking_source)"
    ranking_stale="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" ranking_stale)"
    ranking_reason="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" ranking_reason)"
    selected_upstreams="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" selected_upstreams)"
    upstream_count="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" upstream_count)"
    dnsmasq_process_status="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" dnsmasq_process_status)"
    dnsmasq_port_status="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" dnsmasq_port_status)"

    DNS_CACHE_REASON="${local_reason:-unknown}"
    DNS_CACHE_RESOLV_CONF_STATUS="${local_resolv:-unknown}"
    DNS_CACHE_RESOLV_CONF_HEALTH="${local_resolv_health:-unknown}"
    DNS_CACHE_RESOLV_CONF_NAMESERVERS="${local_nameservers:-unknown}"
    DNS_CACHE_STATUS_STALE="${status_stale:-unknown}"
    DNS_CACHE_STATUS_STALE_REASON="${status_stale_reason:-unknown}"
    DNS_CACHE_RANKING_SOURCE="${ranking_source:-unknown}"
    DNS_CACHE_RANKING_STALE="${ranking_stale:-unknown}"
    DNS_CACHE_RANKING_REASON="${ranking_reason:-unknown}"
    DNS_CACHE_SELECTED_UPSTREAMS="${selected_upstreams:-unknown}"
    DNS_CACHE_UPSTREAM_COUNT="${upstream_count:-0}"
    DNS_CACHE_DNSMASQ_PROCESS_STATUS="${dnsmasq_process_status:-unknown}"
    DNS_CACHE_DNSMASQ_PORT_STATUS="${dnsmasq_port_status:-unknown}"

    nameserver="$(first_nameserver_from_resolv_conf)"
    DNS_RESOLV_CONF_NAMESERVER="${nameserver:-unknown}"
    active_by_resolv="false"
    if [[ "${nameserver}" == "127.0.0.1" || "${nameserver}" == "::1" ]]; then
        active_by_resolv="true"
    fi

    if [[ "${status_stale}" == "true" ]]; then
        DNS_CACHE_STATUS="stale"
    elif [[ "${local_status}" == "ok" && ("${local_resolv}" == "updated" || "${local_resolv_health}" == *"points-to-cache"* || "${active_by_resolv}" == "true") ]]; then
        DNS_CACHE_STATUS="ok"
    elif [[ "${local_status}" == "off" || "${local_status}" == "disabled" ]]; then
        DNS_CACHE_STATUS="off"
    elif [[ "${local_status}" == "stale" ]]; then
        DNS_CACHE_STATUS="stale"
    elif [[ -n "${local_status}" ]]; then
        DNS_CACHE_STATUS="${local_status}"
    elif [[ "${active_by_resolv}" == "true" ]]; then
        DNS_CACHE_STATUS="active-unreported"
    else
        DNS_CACHE_STATUS="unknown"
    fi

    zero_dns="$(awk -F'	' 'NR > 1 && $8 ~ /^[0-9]+$/ && $8 == 0 {c++} END {print c+0}' "${METRICS_FILE}" 2> /dev/null || printf '0')"
    total_dns="$(awk -F'	' 'NR > 1 && $8 ~ /^[0-9]+$/ {c++} END {print c+0}' "${METRICS_FILE}" 2> /dev/null || printf '0')"
    if [[ "${DNS_CACHE_STATUS}" == "ok" && "${total_dns}" =~ ^[0-9]+$ && "${total_dns}" -gt 0 ]]; then
        if ((zero_dns * 2 >= total_dns)); then
            DNS_CACHE_EFFECTIVE="hot"
        elif ((zero_dns > 0)); then
            DNS_CACHE_EFFECTIVE="partial"
        else
            DNS_CACHE_EFFECTIVE="cold-or-bypassed"
        fi
    elif [[ "${DNS_CACHE_STATUS}" == "off" ]]; then
        DNS_CACHE_EFFECTIVE="disabled"
    elif [[ "${DNS_CACHE_STATUS}" == "stale" ]]; then
        DNS_CACHE_EFFECTIVE="stale"
    else
        DNS_CACHE_EFFECTIVE="unknown"
    fi

    append_report "dns_cache status=${DNS_CACHE_STATUS} effective=${DNS_CACHE_EFFECTIVE} nameserver=${DNS_RESOLV_CONF_NAMESERVER} reason=${DNS_CACHE_REASON} resolv_status=${DNS_CACHE_RESOLV_CONF_STATUS} resolv_health=${DNS_CACHE_RESOLV_CONF_HEALTH} status_stale=${DNS_CACHE_STATUS_STALE} stale_reason=${DNS_CACHE_STATUS_STALE_REASON} ranking_source=${DNS_CACHE_RANKING_SOURCE} ranking_stale=${DNS_CACHE_RANKING_STALE} upstream_count=${DNS_CACHE_UPSTREAM_COUNT} dnsmasq=${DNS_CACHE_DNSMASQ_PROCESS_STATUS}/${DNS_CACHE_DNSMASQ_PORT_STATUS}"
}

analyze_current_metrics() {
    local metric_timestamp _url host _klass _expected _http_code _remote_ip _dns_ms _tcp_ms _tls_ms _ttfb_ms total_ms _tls_verify _content_type status _note plane bottleneck
    local rec plane_status github_status copilot_status telemetry_status overall_status
    local total_endpoints total_failures total_slow total_ok
    declare -A plane_total=()
    declare -A plane_ok=()
    declare -A plane_slow=()
    declare -A plane_fail=()
    declare -A plane_worst_host=()
    declare -A plane_worst_total=()
    declare -A plane_bottleneck=()

    reset_current_diagnosis
    detect_dns_cache_state

    if [[ ! -s "${METRICS_FILE}" ]]; then
        printf 'plane	status	endpoints	ok	slow	failures	worst_host	worst_total_ms	primary_bottleneck
' > "${DIAGNOSIS_FILE}" 2> /dev/null || true
        append_report "current_diagnosis=empty"
        return 0
    fi

    total_endpoints=0
    total_failures=0
    total_slow=0
    total_ok=0
    while IFS=$'	' read -r metric_timestamp _url host _klass _expected _http_code _remote_ip _dns_ms _tcp_ms _tls_ms _ttfb_ms total_ms _tls_verify _content_type status _note plane bottleneck; do
        [[ -n "${metric_timestamp}" ]] || continue
        [[ "${metric_timestamp}" != "timestamp" ]] || continue
        [[ -n "${plane}" ]] || plane="other"
        [[ -n "${bottleneck}" ]] || bottleneck="unknown"
        [[ "${total_ms}" =~ ^[0-9]+$ ]] || total_ms=0

        plane_total["${plane}"]=$((${plane_total["${plane}"]:-0} + 1))
        total_endpoints=$((total_endpoints + 1))
        case "${status}" in
            ok)
                plane_ok["${plane}"]=$((${plane_ok["${plane}"]:-0} + 1))
                total_ok=$((total_ok + 1))
                ;;
            slow)
                plane_slow["${plane}"]=$((${plane_slow["${plane}"]:-0} + 1))
                total_slow=$((total_slow + 1))
                ;;
            *)
                plane_fail["${plane}"]=$((${plane_fail["${plane}"]:-0} + 1))
                total_failures=$((total_failures + 1))
                ;;
        esac

        if ((total_ms > ${plane_worst_total["${plane}"]:-0})); then
            plane_worst_total["${plane}"]="${total_ms}"
            plane_worst_host["${plane}"]="${host}"
            plane_bottleneck["${plane}"]="${bottleneck}"
        fi
        if ((total_ms > CURRENT_WORST_TOTAL_MS)); then
            CURRENT_WORST_TOTAL_MS="${total_ms}"
            CURRENT_WORST_HOST="${host}"
            PRIMARY_BOTTLENECK="${bottleneck}"
        fi
    done < "${METRICS_FILE}"

    github_status="$(plane_status_from_counts "${plane_total["github-api"]:-0}" "${plane_fail["github-api"]:-0}" "${plane_slow["github-api"]:-0}")"

    # Copilot transport is intentionally broader than one plane. Token, proxy and API
    # endpoints together represent the practical transport surface used by Copilot.
    local copilot_total copilot_fail copilot_slow copilot_ok
    local copilot_worst_host copilot_worst_total copilot_bottleneck plane_value

    copilot_total=$((${plane_total["copilot-token"]:-0} + ${plane_total["copilot-proxy"]:-0} + ${plane_total["copilot-api"]:-0}))
    copilot_fail=$((${plane_fail["copilot-token"]:-0} + ${plane_fail["copilot-proxy"]:-0} + ${plane_fail["copilot-api"]:-0}))
    copilot_slow=$((${plane_slow["copilot-token"]:-0} + ${plane_slow["copilot-proxy"]:-0} + ${plane_slow["copilot-api"]:-0}))
    copilot_ok=$((${plane_ok["copilot-token"]:-0} + ${plane_ok["copilot-proxy"]:-0} + ${plane_ok["copilot-api"]:-0}))
    copilot_status="$(plane_status_from_counts "${copilot_total}" "${copilot_fail}" "${copilot_slow}")"

    copilot_worst_host=""
    copilot_worst_total=0
    copilot_bottleneck="unknown"
    for plane in copilot-token copilot-proxy copilot-api; do
        plane_value="${plane_worst_total["${plane}"]:-0}"
        [[ "${plane_value}" =~ ^[0-9]+$ ]] || plane_value=0
        if ((plane_value > copilot_worst_total)); then
            copilot_worst_total="${plane_value}"
            copilot_worst_host="${plane_worst_host["${plane}"]:-}"
            copilot_bottleneck="${plane_bottleneck["${plane}"]:-unknown}"
        fi
    done

    telemetry_status="$(plane_status_from_counts "${plane_total["copilot-telemetry"]:-0}" "${plane_fail["copilot-telemetry"]:-0}" "${plane_slow["copilot-telemetry"]:-0}")"
    overall_status="$(plane_status_from_counts "${total_endpoints}" "${total_failures}" "${total_slow}")"

    PLANE_GITHUB_API_STATUS="${github_status}"
    PLANE_COPILOT_TRANSPORT_STATUS="${copilot_status}"
    PLANE_COPILOT_TELEMETRY_STATUS="${telemetry_status}"
    PLANE_OVERALL_STATUS="${overall_status}"

    rec="observe"
    if [[ "${PLANE_GITHUB_API_STATUS}" != "ok" ]]; then
        rec="$(join_recommendation "${rec}" "inspect-github-api-route-fix")"
    fi
    if [[ "${DNS_CACHE_STATUS}" != "ok" && "${PRIMARY_BOTTLENECK}" == "dns-bound" ]]; then
        rec="$(join_recommendation "${rec}" "enable-or-repair-local-dns-cache")"
    elif [[ "${DNS_CACHE_STATUS}" == "ok" && "${PRIMARY_BOTTLENECK}" == "dns-bound" ]]; then
        rec="$(join_recommendation "${rec}" "inspect-dns-upstream-ranking")"
    fi
    if [[ "${PLANE_COPILOT_TRANSPORT_STATUS}" == "degraded" || "${PLANE_COPILOT_TRANSPORT_STATUS}" == "failed" ]]; then
        rec="$(join_recommendation "${rec}" "run-copilot-route-advisor")"
    fi
    if [[ "${PRIMARY_BOTTLENECK}" == "tcp-bound" || "${PRIMARY_BOTTLENECK}" == "tls-bound" || "${PRIMARY_BOTTLENECK}" == "server-bound" ]]; then
        rec="$(join_recommendation "${rec}" "compare-direct-vs-local-proxy")"
    fi
    if [[ "${DNS_CACHE_EFFECTIVE}" == "cold-or-bypassed" && "${DNS_CACHE_STATUS}" == "ok" ]]; then
        rec="$(join_recommendation "${rec}" "warm-dns-cache-and-retest")"
    fi
    RECOMMENDATIONS="${rec:-observe}"

    {
        printf 'plane	status	endpoints	ok	slow	failures	worst_host	worst_total_ms	primary_bottleneck
'
        for plane in github-api copilot-token copilot-proxy copilot-api copilot-telemetry other; do
            [[ -n "${plane_total["${plane}"]:-}" ]] || continue
            plane_status="$(plane_status_from_counts "${plane_total["${plane}"]:-0}" "${plane_fail["${plane}"]:-0}" "${plane_slow["${plane}"]:-0}")"
            printf '%s	%s	%s	%s	%s	%s	%s	%s	%s
' \
                "${plane}" "${plane_status}" "${plane_total["${plane}"]:-0}" "${plane_ok["${plane}"]:-0}" "${plane_slow["${plane}"]:-0}" "${plane_fail["${plane}"]:-0}" \
                "${plane_worst_host["${plane}"]:-}" "${plane_worst_total["${plane}"]:-0}" "${plane_bottleneck["${plane}"]:-unknown}"
        done
        printf '%s	%s	%s	%s	%s	%s	%s	%s	%s
' \
            "__copilot_transport" "${PLANE_COPILOT_TRANSPORT_STATUS}" "${copilot_total}" "${copilot_ok}" "${copilot_slow}" "${copilot_fail}" "${copilot_worst_host}" "${copilot_worst_total}" "${copilot_bottleneck}"
        printf '%s	%s	%s	%s	%s	%s	%s	%s	%s
' \
            "__overall" "${PLANE_OVERALL_STATUS}" "${total_endpoints}" "${total_ok}" "${total_slow}" "${total_failures}" "${CURRENT_WORST_HOST}" "${CURRENT_WORST_TOTAL_MS}" "${PRIMARY_BOTTLENECK}"
    } | safe_write_file "${DIAGNOSIS_FILE}" 0644 || true

    append_report "current_diagnosis=${DIAGNOSIS_FILE} overall=${PLANE_OVERALL_STATUS} github_api=${PLANE_GITHUB_API_STATUS} copilot_transport=${PLANE_COPILOT_TRANSPORT_STATUS} telemetry=${PLANE_COPILOT_TELEMETRY_STATUS} worst_host=${CURRENT_WORST_HOST:-none} worst_total_ms=${CURRENT_WORST_TOTAL_MS} primary_bottleneck=${PRIMARY_BOTTLENECK} recommendations=${RECOMMENDATIONS}"
    return 0
}

# -----------------------------------------------------------------------------
# History / stability analysis
# -----------------------------------------------------------------------------
ensure_history_header_unlocked() {
    [[ "${HISTORY_ENABLED}" == "true" ]] || return 0
    ensure_parent_dir "${HISTORY_FILE}"
    if [[ ! -s "${HISTORY_FILE}" ]]; then
        printf 'timestamp\trun_id\turl\thost\tclass\thttp_code\tremote_ip\tdns_ms\ttcp_ms\ttls_ms\tttfb_ms\ttotal_ms\ttls_verify\tstatus\tnote\tproxy_mode\tip_family\n' > "${HISTORY_FILE}" 2> /dev/null || true
        chmod 0600 "${HISTORY_FILE}" 2> /dev/null || true
    fi
}

append_current_metrics_to_history_unlocked() {
    local tmp data_tmp dir
    [[ "${HISTORY_ENABLED}" == "true" ]] || return 0
    [[ -s "${METRICS_FILE}" ]] || return 0
    ensure_history_header_unlocked

    awk -F'\t' -v OFS='\t' -v run_id="${RUN_ID}" -v proxy="${PROBE_PROXY_MODE}" -v family="${PROBE_IP_FAMILY}" '
        NR == 1 { next }
        NF >= 16 {
            print $1, run_id, $2, $3, $4, $6, $7, $8, $9, $10, $11, $12, $13, $15, $16, proxy, family
        }
    ' "${METRICS_FILE}" >> "${HISTORY_FILE}" 2> /dev/null || true

    dir="$(dirname "${HISTORY_FILE}" 2> /dev/null || printf '/tmp')"
    tmp="$(mktemp "${dir%/}/copilot-history.XXXXXX" 2> /dev/null || true)"
    data_tmp="$(mktemp "${dir%/}/copilot-history-data.XXXXXX" 2> /dev/null || true)"
    if [[ -n "${tmp}" && -n "${data_tmp}" ]]; then
        awk 'NR > 1 {print}' "${HISTORY_FILE}" 2> /dev/null | tail -n "${HISTORY_MAX_LINES}" > "${data_tmp}" 2> /dev/null || true
        {
            head -n 1 "${HISTORY_FILE}" 2> /dev/null || true
            cat "${data_tmp}" 2> /dev/null || true
        } > "${tmp}" 2> /dev/null || true
        mv -f "${tmp}" "${HISTORY_FILE}" 2> /dev/null || rm -f "${tmp}" 2> /dev/null || true
        rm -f "${data_tmp}" 2> /dev/null || true
        chmod 0600 "${HISTORY_FILE}" 2> /dev/null || true
    else
        rm -f "${tmp:-}" "${data_tmp:-}" 2> /dev/null || true
    fi
}

append_current_metrics_to_history() {
    [[ "${HISTORY_ENABLED}" == "true" ]] || return 0
    ensure_parent_dir "${HISTORY_LOCK_FILE}"

    if has_cmd flock; then
        (
            if [[ "${HISTORY_LOCK_WAIT_SECONDS}" -gt 0 ]]; then
                flock -w "${HISTORY_LOCK_WAIT_SECONDS}" -x 9 || exit 98
            else
                flock -x 9 || exit 98
            fi
            append_current_metrics_to_history_unlocked
        ) 9> "${HISTORY_LOCK_FILE}"
        return $?
    fi

    append_current_metrics_to_history_unlocked
}

analyze_history() {
    local current_hosts
    HISTORY_STATUS="stable"
    HISTORY_UNSTABLE_HOSTS="0"
    HISTORY_WORST_HOST=""
    HISTORY_WORST_P95_MS="0"

    [[ "${HISTORY_ENABLED}" == "true" ]] || {
        HISTORY_STATUS="disabled"
        append_report "history=disabled"
        return 0
    }

    ensure_parent_dir "${HISTORY_ANALYSIS_FILE}"
    printf 'host\trecent_count\tfailures\tslow\tok\tavg_total_ms\tp95_total_ms\tmax_total_ms\tunique_remote_ips\tlast_remote_ip\tlast_status\tstatus\n' > "${HISTORY_ANALYSIS_FILE}" 2> /dev/null || true

    if [[ ! -s "${HISTORY_FILE}" ]]; then
        HISTORY_STATUS="empty"
        append_report "history=empty"
        return 0
    fi

    current_hosts="$(awk -F'\t' 'NR > 1 && $3 != "" {seen[$3]=1} END {for (h in seen) print h}' "${METRICS_FILE}" 2> /dev/null || true)"
    if [[ -z "${current_hosts}" ]]; then
        current_hosts="$(awk -F'\t' 'NR > 1 && $4 != "" {seen[$4]=1} END {for (h in seen) print h}' "${HISTORY_FILE}" 2> /dev/null || true)"
    fi

    while IFS= read -r host; do
        [[ -n "${host}" ]] || continue
        awk -F'\t' -v OFS='\t' -v h="${host}" -v window="${HISTORY_WINDOW}" -v fail_threshold="${HISTORY_FAIL_THRESHOLD}" -v slow_threshold="${HISTORY_SLOW_THRESHOLD}" '
            NR == 1 { next }
            $4 == h { line[++n]=$0 }
            function sort_numeric(a, n,    i,j,tmp) {
                for (i=1; i<=n; i++) for (j=i+1; j<=n; j++) if (a[j] < a[i]) { tmp=a[i]; a[i]=a[j]; a[j]=tmp }
            }
            END {
                start=n-window+1
                if (start < 1) start=1
                count=0; fail=0; slow=0; ok=0; sum=0; max=0; remote_count=0; last_remote=""; last_status="unknown"
                delete totals
                delete remotes
                for (i=start; i<=n; i++) {
                    split(line[i], f, FS)
                    count++
                    total=f[12]+0
                    status=f[14]
                    remote=f[7]
                    totals[count]=total
                    sum+=total
                    if (total > max) max=total
                    if (remote != "" && !(remote in remotes)) { remotes[remote]=1; remote_count++ }
                    last_remote=remote
                    last_status=status
                    if (status == "ok") ok++
                    else if (status == "slow") slow++
                    else fail++
                }
                avg=(count > 0 ? int(sum/count) : 0)
                p95=0
                if (count > 0) {
                    sort_numeric(totals, count)
                    pidx=int(count*0.95)
                    if (pidx < 1) pidx=1
                    if (pidx < count && (count*0.95) > pidx) pidx++
                    if (pidx > count) pidx=count
                    p95=totals[pidx]
                }
                st="stable"
                if (fail >= fail_threshold || slow >= slow_threshold) st="unstable"
                print h, count, fail, slow, ok, avg, p95, max, remote_count, last_remote, last_status, st
            }
        ' "${HISTORY_FILE}" >> "${HISTORY_ANALYSIS_FILE}" 2> /dev/null || true
    done <<< "${current_hosts}"

    HISTORY_UNSTABLE_HOSTS="$(awk -F'\t' 'NR > 1 && $12 == "unstable" {c++} END {print c+0}' "${HISTORY_ANALYSIS_FILE}" 2> /dev/null || printf '0')"
    HISTORY_WORST_HOST="$(awk -F'\t' 'NR > 1 { if ($7+0 > max) {max=$7+0; host=$1} } END {print host}' "${HISTORY_ANALYSIS_FILE}" 2> /dev/null || true)"
    HISTORY_WORST_P95_MS="$(awk -F'\t' 'NR > 1 { if ($7+0 > max) max=$7+0 } END {print max+0}' "${HISTORY_ANALYSIS_FILE}" 2> /dev/null || printf '0')"
    if [[ "${HISTORY_UNSTABLE_HOSTS}" -gt 0 ]]; then
        HISTORY_STATUS="unstable"
    else
        HISTORY_STATUS="stable"
    fi
    append_report "history_analysis=${HISTORY_ANALYSIS_FILE} status=${HISTORY_STATUS} unstable_hosts=${HISTORY_UNSTABLE_HOSTS} worst_host=${HISTORY_WORST_HOST:-none} worst_p95_ms=${HISTORY_WORST_P95_MS} window=${HISTORY_WINDOW}"
    return 0
}

status_action() {
    local current
    current="$(read_first_line "${STATUS_FILE}" "unknown")"
    log_info "status=${current}; report=${REPORT_FILE}; metrics=${METRICS_FILE}; summary=${SUMMARY_FILE}; history=${HISTORY_FILE}"
    append_report "status_action current=${current}"
    return 0
}

history_action() {
    if [[ "${HISTORY_ENABLED}" != "true" ]]; then
        log_info "history=disabled"
        return 0
    fi
    analyze_history
    log_info "history=${HISTORY_FILE}; analysis=${HISTORY_ANALYSIS_FILE}; status=${HISTORY_STATUS}; unstable_hosts=${HISTORY_UNSTABLE_HOSTS}"
    if [[ -r "${HISTORY_ANALYSIS_FILE}" ]]; then
        cat "${HISTORY_ANALYSIS_FILE}" 2> /dev/null || true
    fi
    return 0
}

doctor_action() {
    local rc
    rc=0
    log_info "doctor: validando dependências e contrato de rede."
    for cmd in curl awk date mktemp head tail chmod mv; do
        if has_cmd "${cmd}"; then
            log_ok "doctor: ${cmd} disponível."
        else
            log_warn "doctor: ${cmd} indisponível."
            rc=1
        fi
    done
    if has_cmd timeout; then log_ok "doctor: timeout disponível."; else log_warn "doctor: timeout ausente; timeouts externos ficam limitados."; fi
    if has_cmd flock; then log_ok "doctor: flock disponível."; else log_warn "doctor: flock ausente; locks serão best-effort."; fi
    if [[ -f "${GITHUB_API_ROUTE_SCRIPT}" ]]; then log_ok "doctor: route-fix encontrado: ${GITHUB_API_ROUTE_SCRIPT}"; else
        log_warn "doctor: route-fix ausente: ${GITHUB_API_ROUTE_SCRIPT}"
        rc=1
    fi
    if [[ -r "${LOCAL_DNS_SUMMARY_FILE}" ]]; then
        detect_dns_cache_state
        log_ok "doctor: summary do DNS cache local legível: ${LOCAL_DNS_SUMMARY_FILE}"
        log_info "doctor: dns_cache_status=${DNS_CACHE_STATUS}; effective=${DNS_CACHE_EFFECTIVE}; resolv_health=${DNS_CACHE_RESOLV_CONF_HEALTH}; stale=${DNS_CACHE_STATUS_STALE}; ranking=${DNS_CACHE_RANKING_SOURCE}/${DNS_CACHE_RANKING_STALE}."
    else
        log_warn "doctor: summary do DNS cache local ausente; normal se o cache estiver desligado ou ainda não rodou."
    fi
    validate_manager_contract
    return "${rc}"
}

validate_manager_contract() {
    if [[ "${GITHUB_API_HOST}" != "api.github.com" && "${ALLOW_CUSTOM_GITHUB_API_HOST}" != "true" ]]; then
        append_report "contract_warning=custom_github_api_host_blocked host=${GITHUB_API_HOST}"
    fi
    if [[ "${PROBE_IP_FAMILY}" == "6" ]]; then
        append_report "contract_warning=ipv6_probe_mode_explicit; api.github.com may not expose usable AAAA in this environment"
    fi
    if [[ "${PROBE_PROXY_MODE}" == "local" && "${ALLOW_NON_LOOPBACK_LOCAL_PROXY}" != "true" ]]; then
        if ! is_loopback_proxy_url "${LOCAL_PROXY_URL}"; then
            append_report "contract_warning=unsafe_local_proxy_url url=$(redact_url_credentials "${LOCAL_PROXY_URL}")"
        fi
    fi
}

main_unlocked() {
    local route_rc probes_rc final_rc final_status final_result history_status unstable_hosts
    write_headers
    log_info "GitHub/Copilot Network Manager iniciado (v${SCRIPT_VERSION}); action=${ACTION}; mode=${MANAGER_MODE}."
    log_debug "PATH=${PATH:-<unset>}"
    log_debug "ENDPOINTS=${ENDPOINTS}"
    log_debug "PROBE_IP_FAMILY=${PROBE_IP_FAMILY}; PROBE_PROXY_MODE=${PROBE_PROXY_MODE}; PARALLEL=${PROBE_PARALLEL}"
    validate_manager_contract

    if [[ "${MANAGER_MODE}" == "off" ]]; then
        write_status "off"
        append_report "result=off"
        write_summary "0" "0" "0" "0" "0" "0" "off" "disabled" "0"
        log_info "manager desligado por DEVCONTAINER_COPILOT_NETWORK_MANAGER_MODE=off."
        return 0
    fi

    case "${ACTION}" in
        status)
            status_action
            return 0
            ;;
        history)
            history_action
            write_summary "0" "0" "0" "0" "0" "0" "history" "${HISTORY_STATUS}" "${HISTORY_UNSTABLE_HOSTS}"
            return 0
            ;;
        doctor)
            doctor_action
            return $?
            ;;
    esac

    route_rc=0
    if [[ "${ACTION}" != "probe" && "${RUN_API_ROUTE_FIX}" == "true" ]]; then
        run_api_route_fix
        route_rc=$?
        if [[ "${route_rc}" -ne 0 ]]; then
            ROUTE_FIX_DECISION="failed"
            log_warn "route-fix de ${GITHUB_API_HOST} falhou ou não provou rota funcional (rc=${route_rc})."
            append_report "api_route_fix=failed rc=${route_rc}"
        else
            ROUTE_FIX_DECISION="ok"
            append_report "api_route_fix=ok"
        fi
    else
        ROUTE_FIX_SUMMARY_ALLOWED="false"
        ROUTE_FIX_DECISION="skipped-action-${ACTION}"
        append_report "api_route_fix=skipped action=${ACTION}"
    fi

    probe_all_endpoints
    probes_rc=$?

    analyze_current_metrics

    if ! append_current_metrics_to_history; then
        append_report "history_append=failed_or_lock_timeout"
    fi
    analyze_history
    history_status="${HISTORY_STATUS}"
    unstable_hosts="${HISTORY_UNSTABLE_HOSTS}"

    final_rc=0
    final_status="ok"
    if [[ "${route_rc}" -ne 0 && "${FAIL_ON_ROUTE_FIX}" == "true" ]]; then
        final_rc=1
        final_status="failed"
    elif [[ "${probes_rc}" -ne 0 ]]; then
        final_status="degraded"
        if [[ "${FAIL_ON_DEGRADED}" == "true" ]]; then
            final_rc=1
        fi
    elif [[ "${history_status}" == "unstable" && "${MARK_UNSTABLE_AS_DEGRADED}" == "true" ]]; then
        final_status="degraded"
        if [[ "${FAIL_ON_UNSTABLE}" == "true" ]]; then
            final_rc=1
        fi
    fi

    write_status "${final_status}"
    write_summary "${route_rc}" "${probes_rc}" "${PROBES_FAILURES:-0}" "${PROBES_SLOW:-0}" "${PROBES_OK:-0}" "${PROBES_TOTAL:-0}" "${final_status}" "${history_status}" "${unstable_hosts}"

    if [[ "${final_rc}" -eq 0 ]]; then
        log_ok "GitHub/Copilot Network Manager concluído. status=${final_status}; history=${history_status}"
    else
        log_warn "GitHub/Copilot Network Manager falhou. status=${final_status}; history=${history_status}"
    fi

    if [[ "${final_rc}" -eq 0 ]]; then
        final_result="ok"
    else
        final_result="failed"
    fi
    append_report "result=${final_result} status=${final_status} history=${history_status} unstable_hosts=${unstable_hosts} route_rc=${route_rc} probes_rc=${probes_rc} failures=${PROBES_FAILURES:-0} slow=${PROBES_SLOW:-0} ok=${PROBES_OK:-0} total=${PROBES_TOTAL:-0}"
    return "${final_rc}"
}

main() {
    ensure_parent_dir "${LOCK_FILE}"
    if has_cmd flock; then
        (
            if [[ "${LOCK_WAIT_SECONDS}" -gt 0 ]]; then
                flock -w "${LOCK_WAIT_SECONDS}" -x 9 || exit 98
            else
                flock -x 9 || exit 98
            fi
            main_unlocked
        ) 9> "${LOCK_FILE}"
        return $?
    fi
    main_unlocked
}

main "$@"
exit $?
