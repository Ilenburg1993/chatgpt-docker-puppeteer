#!/usr/bin/env bash
# =============================================================================
# copilot-route-advisor.sh — Passive Copilot Route Advisor
# Version: v1.0.1
#
# Purpose:
#   Passive, runtime-only route advisory layer for GitHub Copilot endpoints inside
#   DevContainers. It tests candidate IPs for allowlisted Copilot hosts using
#   HTTPS + TLS/SNI-preserving curl --resolve, writes metrics/reports, and emits
#   recommendations. It never mutates /etc/hosts, /etc/resolv.conf, Docker, VS
#   Code, proxy settings, or application services.
#
# Architecture role:
#   post-start.sh
#     -> local-dns-cache.sh                  [active DNS cache; optional]
#     -> github-api-route-fix.sh             [active /etc/hosts mutation only for api.github.com]
#     -> github-copilot-network-manager.sh   [passive transport manager]
#          -> copilot-route-advisor.sh        [passive route advisory; opt-in/manual]
#
# Contract:
#   - Advisory only: no route, DNS, proxy, hosts, Docker or service mutation.
#   - Default target set excludes api.github.com, because api.github.com is owned
#     by github-api-route-fix.sh. It can be included explicitly for observation.
#   - Validates only official/expected Copilot host shapes unless custom endpoint
#     mode is explicitly enabled.
#   - Treats HTTP 400/401/403/404/405 as potentially healthy for unauthenticated
#     Copilot transport probes when the TLS/HTTP shape is valid.
#   - Produces machine-readable TSV metrics and summary files for post-attach,
#     post-start, future manager integration and human A/B analysis.
#   - Fails closed only for tool/contract errors. A worse candidate is not a
#     failure; it is an advisory observation.
#
# v1.0.1 focus:
#   - Fixes ShellCheck SC2015 in temporary output cleanup paths.
#   - Keeps status action passive: it no longer truncates current artifacts.
#   - Synchronizes DNS cache summary/status aliases with local-dns-cache v1.5.0.
#   - Adds manager v1.4.x summary context to advisor summaries.
#   - Hardens curl failure reason capture and temporary-file cleanup.
#   - Still advisory-only: no mutation and no automatic proxy/DNS/hosts changes.
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
SCRIPT_NAME="copilot-route-advisor.sh"
readonly SCRIPT_NAME
SCRIPT_VERSION="1.0.1"
readonly SCRIPT_VERSION
RUN_ID="$(date '+%Y%m%dT%H%M%S%z' 2> /dev/null)-$$"
readonly RUN_ID

ACTION="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ACTION:-start}"
case "${ACTION}" in
    start | probe | status | doctor) : ;;
    *) ACTION="start" ;;
esac
readonly ACTION

ADVISOR_MODE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_MODE:-active}"
case "${ADVISOR_MODE}" in
    off | disabled | false) ADVISOR_MODE="off" ;;
    active | on | true | enabled) ADVISOR_MODE="active" ;;
    *) ADVISOR_MODE="active" ;;
esac
readonly ADVISOR_MODE

REPORT_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_REPORT_FILE:-/tmp/devcontainer-copilot-route-advisor.report}"
readonly REPORT_FILE
METRICS_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_METRICS_FILE:-/tmp/devcontainer-copilot-route-advisor.metrics.tsv}"
readonly METRICS_FILE
DECISIONS_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_DECISIONS_FILE:-/tmp/devcontainer-copilot-route-advisor.decisions.tsv}"
readonly DECISIONS_FILE
STATUS_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_STATUS_FILE:-/tmp/devcontainer-copilot-route-advisor.status}"
readonly STATUS_FILE
SUMMARY_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_SUMMARY_FILE:-/tmp/devcontainer-copilot-route-advisor.summary}"
readonly SUMMARY_FILE
LOCK_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_LOCK_FILE:-/tmp/devcontainer-network/copilot-route-advisor.lock}"
readonly LOCK_FILE
LOCK_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_LOCK_WAIT_SECONDS:-20}" 20 0 300)"
readonly LOCK_WAIT_SECONDS

CONNECT_TIMEOUT="$(cfg_uint "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_CONNECT_TIMEOUT:-4}" 4 1 60)"
readonly CONNECT_TIMEOUT
MAX_TIME="$(cfg_uint "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_MAX_TIME:-12}" 12 2 180)"
readonly MAX_TIME
MAX_CANDIDATES_PER_HOST="$(cfg_uint "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_MAX_CANDIDATES_PER_HOST:-12}" 12 1 64)"
readonly MAX_CANDIDATES_PER_HOST
WARN_TOTAL_MS="$(cfg_uint "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_WARN_TOTAL_MS:-1500}" 1500 0 120000)"
readonly WARN_TOTAL_MS
MIN_VALID_SCORE="$(cfg_uint "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_MIN_VALID_SCORE:-70}" 70 1 150)"
readonly MIN_VALID_SCORE
SWITCH_MIN_IMPROVEMENT_MS="$(cfg_uint "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_SWITCH_MIN_IMPROVEMENT_MS:-100}" 100 0 60000)"
readonly SWITCH_MIN_IMPROVEMENT_MS
SWITCH_RATIO_PERCENT="$(cfg_uint "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_SWITCH_RATIO_PERCENT:-80}" 80 1 100)"
readonly SWITCH_RATIO_PERCENT

PROBE_IP_FAMILY="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_IP_FAMILY:-4}"
case "${PROBE_IP_FAMILY}" in
    4 | 6 | auto) : ;;
    *) PROBE_IP_FAMILY="4" ;;
esac
readonly PROBE_IP_FAMILY

PROBE_PROXY_MODE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_PROXY_MODE:-direct}"
case "${PROBE_PROXY_MODE}" in
    direct | environment) : ;;
    *) PROBE_PROXY_MODE="direct" ;;
esac
readonly PROBE_PROXY_MODE

STRICT_REMOTE_IP_MATCH="$(cfg_bool "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_STRICT_REMOTE_IP_MATCH:-true}" true)"
readonly STRICT_REMOTE_IP_MATCH
ALLOW_CUSTOM_ENDPOINTS="$(cfg_bool "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ALLOW_CUSTOM_ENDPOINTS:-false}" false)"
readonly ALLOW_CUSTOM_ENDPOINTS
INCLUDE_GITHUB_API="$(cfg_bool "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_INCLUDE_GITHUB_API:-false}" false)"
readonly INCLUDE_GITHUB_API
ENABLE_EXTENDED_ENDPOINTS="$(cfg_bool "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_EXTENDED_ENDPOINTS:-false}" false)"
readonly ENABLE_EXTENDED_ENDPOINTS
ENABLE_IPV6_CANDIDATES="$(cfg_bool "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ENABLE_IPV6:-false}" false)"
readonly ENABLE_IPV6_CANDIDATES

RESOLVERS="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_RESOLVERS:-1.1.1.1 1.0.0.1 8.8.8.8 8.8.4.4 9.9.9.9 149.112.112.112}"
readonly RESOLVERS
LOCAL_DNS_SUMMARY_FILE="${DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.summary}}"
readonly LOCAL_DNS_SUMMARY_FILE
LOCAL_DNS_STATUS_FILE="${DEVCONTAINER_LOCAL_DNS_STATUS_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_STATUS_FILE:-/tmp/devcontainer-local-dns-cache.status}}"
readonly LOCAL_DNS_STATUS_FILE
MANAGER_METRICS_FILE="${DEVCONTAINER_COPILOT_NETWORK_METRICS_FILE:-/tmp/devcontainer-copilot-network.metrics.tsv}"
readonly MANAGER_METRICS_FILE
MANAGER_SUMMARY_FILE="${DEVCONTAINER_COPILOT_NETWORK_SUMMARY_FILE:-/tmp/devcontainer-copilot-network.summary}"
readonly MANAGER_SUMMARY_FILE
GITHUB_ROUTE_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.summary}"
readonly GITHUB_ROUTE_SUMMARY_FILE
PROBE_TMP_DIR="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_TMP_DIR:-/tmp}"
readonly PROBE_TMP_DIR

DEFAULT_ENDPOINTS="https://copilot-proxy.githubusercontent.com https://default.exp-tas.com https://api.githubcopilot.com https://api.individual.githubcopilot.com https://proxy.individual.githubcopilot.com"
EXTENDED_ENDPOINTS="https://origin-tracker.githubusercontent.com https://copilot-telemetry.githubusercontent.com/telemetry https://collector.github.com"
GITHUB_API_ENDPOINTS="https://api.github.com/copilot_internal/v2/token"
if [[ "${ENABLE_EXTENDED_ENDPOINTS}" == "true" ]]; then
    ENDPOINTS="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ENDPOINTS:-${DEFAULT_ENDPOINTS} ${EXTENDED_ENDPOINTS}}"
else
    ENDPOINTS="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ENDPOINTS:-${DEFAULT_ENDPOINTS}}"
fi
if [[ "${INCLUDE_GITHUB_API}" == "true" ]]; then
    ENDPOINTS="${ENDPOINTS} ${GITHUB_API_ENDPOINTS}"
fi
readonly ENDPOINTS

ADVISOR_STATUS="unknown"
ENDPOINTS_TOTAL=0
ENDPOINTS_OK=0
ENDPOINTS_WITH_BETTER_CANDIDATE=0
ENDPOINTS_CURRENT_FAILED=0
ENDPOINTS_NO_VALID_CANDIDATE=0
CANDIDATES_TOTAL=0
CANDIDATES_VALID=0
GLOBAL_WORST_HOST=""
GLOBAL_WORST_TOTAL_MS="0"
GLOBAL_BEST_IMPROVEMENT_MS="0"
RECOMMENDATIONS="observe"

# -----------------------------------------------------------------------------
# Logging / IO helpers
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

summary_value_from_file() {
    local file key
    file="${1:-}"
    key="${2:-}"
    [[ -r "${file}" && -n "${key}" ]] || return 0
    awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}' "${file}" 2> /dev/null
}

read_first_line_from_file() {
    local file value
    file="${1:-}"
    [[ -r "${file}" ]] || return 0
    value="$(awk 'NR == 1 {print; exit}' "${file}" 2> /dev/null || true)"
    printf '%s' "${value}"
}

safe_remove_temp_file() {
    local target
    target="${1:-}"
    [[ -n "${target}" && "${target}" != "/dev/null" ]] || return 0
    rm -f -- "${target}" 2> /dev/null || true
}

join_recommendation() {
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

write_headers() {
    ensure_parent_dir "${REPORT_FILE}"
    ensure_parent_dir "${METRICS_FILE}"
    ensure_parent_dir "${DECISIONS_FILE}"
    ensure_parent_dir "${SUMMARY_FILE}"
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'run_id=%s\n' "${RUN_ID}"
        printf 'action=%s\n' "${ACTION}"
        printf 'mode=%s\n' "${ADVISOR_MODE}"
        printf 'endpoints=%s\n' "${ENDPOINTS}"
        printf 'include_github_api=%s\n' "${INCLUDE_GITHUB_API}"
        printf 'extended_endpoints=%s\n' "${ENABLE_EXTENDED_ENDPOINTS}"
        printf 'probe_ip_family=%s\n' "${PROBE_IP_FAMILY}"
        printf 'proxy_mode=%s\n' "${PROBE_PROXY_MODE}"
        printf 'strict_remote_ip_match=%s\n' "${STRICT_REMOTE_IP_MATCH}"
        printf 'max_candidates_per_host=%s\n' "${MAX_CANDIDATES_PER_HOST}"
        printf 'connect_timeout=%s\n' "${CONNECT_TIMEOUT}"
        printf 'max_time=%s\n' "${MAX_TIME}"
        printf 'warn_total_ms=%s\n' "${WARN_TOTAL_MS}"
        printf 'manager_metrics=%s\n' "${MANAGER_METRICS_FILE}"
        printf 'github_route_summary=%s\n' "${GITHUB_ROUTE_SUMMARY_FILE}"
        printf 'local_dns_summary=%s\n' "${LOCAL_DNS_SUMMARY_FILE}"
        printf 'local_dns_status=%s\n' "${LOCAL_DNS_STATUS_FILE}"
        printf 'manager_summary=%s\n' "${MANAGER_SUMMARY_FILE}"
        printf '\n'
    } > "${REPORT_FILE}" 2> /dev/null || true

    printf 'timestamp\turl\thost\tip\trecord_kind\thttp_code\tremote_ip\tdns_ms\ttcp_ms\ttls_ms\tttfb_ms\ttotal_ms\ttls_verify\tcontent_type\texpected\tstatus\tscore\tbottleneck\treason\n' \
        | safe_write_file "${METRICS_FILE}" 0644 || true
    printf 'host\turl\tcurrent_ip\tcurrent_status\tcurrent_total_ms\tbest_ip\tbest_status\tbest_score\tbest_total_ms\timprovement_ms\trecommendation\trisk\treason\n' \
        | safe_write_file "${DECISIONS_FILE}" 0644 || true
    : > "${SUMMARY_FILE}" 2> /dev/null || true
    write_status "running"
}

write_summary() {
    local status reason github_route_ip github_route_status dns_cache_status dns_cache_reason dns_cache_resolv_health
    local dns_cache_stale dns_cache_stale_reason dns_cache_ranking_source dns_cache_ranking_stale dns_cache_selected_upstreams
    local manager_status manager_overall manager_recommendations manager_worst_host manager_worst_total
    status="${1:-unknown}"
    reason="${2:-none}"
    github_route_ip="$(summary_value_from_file "${GITHUB_ROUTE_SUMMARY_FILE}" selected_ip)"
    github_route_status="$(summary_value_from_file "${GITHUB_ROUTE_SUMMARY_FILE}" status)"
    dns_cache_status="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" status)"
    if [[ -z "${dns_cache_status}" ]]; then
        dns_cache_status="$(read_first_line_from_file "${LOCAL_DNS_STATUS_FILE}")"
    fi
    dns_cache_reason="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" reason)"
    dns_cache_resolv_health="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" resolv_conf_health)"
    dns_cache_stale="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" status_stale)"
    dns_cache_stale_reason="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" status_stale_reason)"
    dns_cache_ranking_source="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" ranking_source)"
    dns_cache_ranking_stale="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" ranking_stale)"
    dns_cache_selected_upstreams="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" selected_upstreams)"
    manager_status="$(summary_value_from_file "${MANAGER_SUMMARY_FILE}" status)"
    manager_overall="$(summary_value_from_file "${MANAGER_SUMMARY_FILE}" plane_overall_status)"
    manager_recommendations="$(summary_value_from_file "${MANAGER_SUMMARY_FILE}" recommendations)"
    manager_worst_host="$(summary_value_from_file "${MANAGER_SUMMARY_FILE}" current_worst_host)"
    manager_worst_total="$(summary_value_from_file "${MANAGER_SUMMARY_FILE}" current_worst_total_ms)"
    {
        printf 'status=%s\n' "${status}"
        printf 'reason=%s\n' "${reason}"
        printf 'script_version=%s\n' "${SCRIPT_VERSION}"
        printf 'run_id=%s\n' "${RUN_ID}"
        printf 'advisor_status=%s\n' "${ADVISOR_STATUS}"
        printf 'endpoints_total=%s\n' "${ENDPOINTS_TOTAL}"
        printf 'endpoints_ok=%s\n' "${ENDPOINTS_OK}"
        printf 'endpoints_current_failed=%s\n' "${ENDPOINTS_CURRENT_FAILED}"
        printf 'endpoints_with_better_candidate=%s\n' "${ENDPOINTS_WITH_BETTER_CANDIDATE}"
        printf 'endpoints_no_valid_candidate=%s\n' "${ENDPOINTS_NO_VALID_CANDIDATE}"
        printf 'candidates_total=%s\n' "${CANDIDATES_TOTAL}"
        printf 'candidates_valid=%s\n' "${CANDIDATES_VALID}"
        printf 'global_worst_host=%s\n' "${GLOBAL_WORST_HOST:-unknown}"
        printf 'global_worst_total_ms=%s\n' "${GLOBAL_WORST_TOTAL_MS:-0}"
        printf 'global_best_improvement_ms=%s\n' "${GLOBAL_BEST_IMPROVEMENT_MS:-0}"
        printf 'recommendations=%s\n' "${RECOMMENDATIONS:-observe}"
        printf 'github_route_status=%s\n' "${github_route_status:-unknown}"
        printf 'github_route_selected_ip=%s\n' "${github_route_ip:-unknown}"
        printf 'local_dns_cache_status=%s\n' "${dns_cache_status:-unknown}"
        printf 'local_dns_cache_reason=%s\n' "${dns_cache_reason:-unknown}"
        printf 'local_dns_cache_resolv_conf_health=%s\n' "${dns_cache_resolv_health:-unknown}"
        printf 'local_dns_cache_status_stale=%s\n' "${dns_cache_stale:-unknown}"
        printf 'local_dns_cache_status_stale_reason=%s\n' "${dns_cache_stale_reason:-unknown}"
        printf 'local_dns_cache_ranking_source=%s\n' "${dns_cache_ranking_source:-unknown}"
        printf 'local_dns_cache_ranking_stale=%s\n' "${dns_cache_ranking_stale:-unknown}"
        printf 'local_dns_cache_selected_upstreams=%s\n' "${dns_cache_selected_upstreams:-unknown}"
        printf 'manager_status=%s\n' "${manager_status:-unknown}"
        printf 'manager_plane_overall_status=%s\n' "${manager_overall:-unknown}"
        printf 'manager_recommendations=%s\n' "${manager_recommendations:-unknown}"
        printf 'manager_current_worst_host=%s\n' "${manager_worst_host:-unknown}"
        printf 'manager_current_worst_total_ms=%s\n' "${manager_worst_total:-0}"
        printf 'local_dns_status_file=%s\n' "${LOCAL_DNS_STATUS_FILE}"
        printf 'local_dns_summary=%s\n' "${LOCAL_DNS_SUMMARY_FILE}"
        printf 'manager_summary=%s\n' "${MANAGER_SUMMARY_FILE}"
        printf 'report=%s\n' "${REPORT_FILE}"
        printf 'metrics=%s\n' "${METRICS_FILE}"
        printf 'decisions=%s\n' "${DECISIONS_FILE}"
        printf 'completed_at=%s\n' "$(ts)"
    } | safe_write_file "${SUMMARY_FILE}" 0644 || true
}

# -----------------------------------------------------------------------------
# Generic helpers
# -----------------------------------------------------------------------------
has_cmd() { command -v "$1" > /dev/null 2>&1; }
is_nonnegative_int() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

split_words_to_lines() {
    local value item
    local -a items=()
    value="${1:-}"
    read -r -a items <<< "${value}"
    for item in "${items[@]}"; do
        [[ -n "${item}" ]] && printf '%s\n' "${item}"
    done
}

lowercase() {
    printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'
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
    if ((diff < 0)); then diff=0; fi
    printf '%s' "${diff}"
}

url_host() {
    local url no_proto host
    url="${1:-}"
    no_proto="${url#*://}"
    host="${no_proto%%/*}"
    host="${host%%:*}"
    printf '%s' "${host}"
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

is_allowed_host() {
    local host
    host="$(lowercase "${1:-}")"
    if [[ "${ALLOW_CUSTOM_ENDPOINTS}" == "true" ]]; then return 0; fi
    if [[ "${host}" == "api.github.com" && "${INCLUDE_GITHUB_API}" == "true" ]]; then return 0; fi
    if [[ "${host}" == "copilot-proxy.githubusercontent.com" ]]; then return 0; fi
    if [[ "${host}" == "origin-tracker.githubusercontent.com" ]]; then return 0; fi
    if [[ "${host}" == "copilot-telemetry.githubusercontent.com" ]]; then return 0; fi
    if [[ "${host}" == "collector.github.com" ]]; then return 0; fi
    if [[ "${host}" == "default.exp-tas.com" ]]; then return 0; fi
    if [[ "${host}" == *.githubcopilot.com ]]; then return 0; fi
    return 1
}

is_safe_https_url() {
    local url host hostport no_proto
    url="${1:-}"
    [[ "${url}" == https://* ]] || return 1
    [[ "${url}" != *$'\n'* && "${url}" != *$'\r'* && "${url}" != *$'\t'* ]] || return 1
    no_proto="${url#https://}"
    hostport="${no_proto%%/*}"
    [[ "${hostport}" != *:* ]] || return 1
    host="$(url_host "${url}")"
    is_safe_hostname "${host}" || return 1
    is_allowed_host "${host}" || return 1
    return 0
}

is_ipv4() {
    awk -v ip="${1:-}" 'BEGIN {
        n=split(ip,a,"."); if (n != 4) exit 1;
        for (i=1;i<=4;i++) {
            if (a[i] !~ /^[0-9]+$/) exit 1;
            if (a[i] < 0 || a[i] > 255) exit 1;
        }
        exit 0;
    }' 2> /dev/null
}

is_public_ipv4_candidate() {
    is_ipv4 "${1:-}" || return 1
    awk -v ip="${1:-}" 'BEGIN {
        split(ip,a,"."); a1=a[1]+0; a2=a[2]+0; a3=a[3]+0; a4=a[4]+0;
        if (a1 == 0) exit 1;
        if (a1 == 10) exit 1;
        if (a1 == 100 && a2 >= 64 && a2 <= 127) exit 1;
        if (a1 == 127) exit 1;
        if (a1 == 169 && a2 == 254) exit 1;
        if (a1 == 172 && a2 >= 16 && a2 <= 31) exit 1;
        if (a1 == 192 && a2 == 0 && a3 == 0) exit 1;
        if (a1 == 192 && a2 == 0 && a3 == 2) exit 1;
        if (a1 == 192 && a2 == 168) exit 1;
        if (a1 == 198 && (a2 == 18 || a2 == 19)) exit 1;
        if (a1 == 198 && a2 == 51 && a3 == 100) exit 1;
        if (a1 == 203 && a2 == 0 && a3 == 113) exit 1;
        if (a1 >= 224) exit 1;
        if (a1 == 255 && a2 == 255 && a3 == 255 && a4 == 255) exit 1;
        exit 0;
    }' 2> /dev/null
}

is_ipv6_candidate() {
    [[ "${ENABLE_IPV6_CANDIDATES}" == "true" ]] || return 1
    [[ "${1:-}" == *:* ]] || return 1
    if has_cmd python3; then
        python3 - "${1:-}" << 'PY' > /dev/null 2>&1
import ipaddress, sys
try:
    ip = ipaddress.IPv6Address(sys.argv[1])
except Exception:
    sys.exit(1)
if ip.ipv4_mapped is not None:
    sys.exit(1)
if ip.is_unspecified or ip.is_loopback or ip.is_multicast or ip.is_link_local:
    sys.exit(1)
sys.exit(0)
PY
        return $?
    fi
    [[ "${1:-}" =~ ^[0-9A-Fa-f:]+$ && "${1:-}" != ::ffff:* ]]
}

is_ip_candidate() {
    is_public_ipv4_candidate "${1:-}" || is_ipv6_candidate "${1:-}"
}

curl_family_arg() {
    case "${PROBE_IP_FAMILY}" in
        4) printf -- '-4' ;;
        6) printf -- '-6' ;;
        *) printf '' ;;
    esac
}

curl_resolve_value() {
    local host ip
    host="${1:-}"
    ip="${2:-}"
    if [[ "${ip}" == *:* ]]; then
        printf '%s:443:[%s]' "${host}" "${ip}"
    else
        printf '%s:443:%s' "${host}" "${ip}"
    fi
}

extract_field() {
    local key line
    key="${1:-}"
    line="${2:-}"
    printf '%s' "${line}" | tr '|' '\n' | awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}'
}

endpoint_class() {
    local url host
    url="${1:-}"
    host="$(lowercase "$(url_host "${url}")")"
    if [[ "${url}" == https://api.github.com/copilot_internal/* ]]; then
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

expected_status_label() {
    local url host
    url="${1:-}"
    host="$(lowercase "$(url_host "${url}")")"
    if [[ "${url}" == https://api.github.com/copilot_internal/* ]]; then
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
    url="${1:-}"
    code="${2:-}"
    host="$(lowercase "$(url_host "${url}")")"
    if [[ "${url}" == https://api.github.com/copilot_internal/* ]]; then
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
        fail | tls-fail | unexpected-http | remote-mismatch)
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
    if ((max_phase < 25)); then label="low-latency"; fi
    printf '%s' "${label}"
}

append_metric() {
    local url host ip record_kind http_code remote_ip dns_ms tcp_ms tls_ms ttfb_ms total_ms tls_verify content_type expected status score bottleneck reason
    url="${1:-}"
    host="${2:-}"
    ip="${3:-}"
    record_kind="${4:-candidate}"
    http_code="${5:-000}"
    remote_ip="${6:-unknown}"
    dns_ms="${7:-0}"
    tcp_ms="${8:-0}"
    tls_ms="${9:-0}"
    ttfb_ms="${10:-0}"
    total_ms="${11:-0}"
    tls_verify="${12:-?}"
    content_type="${13:-none}"
    expected="${14:-unknown}"
    status="${15:-unknown}"
    score="${16:-0}"
    bottleneck="${17:-unknown}"
    reason="${18:-}"
    reason="$(printf '%s' "${reason}" | tr '\t\n' '  ')"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$(ts)" "${url}" "${host}" "${ip:-unknown}" "${record_kind}" "${http_code}" "${remote_ip}" \
        "${dns_ms}" "${tcp_ms}" "${tls_ms}" "${ttfb_ms}" "${total_ms}" "${tls_verify}" \
        "${content_type:-none}" "${expected}" "${status}" "${score}" "${bottleneck}" "${reason}" \
        >> "${METRICS_FILE}" 2> /dev/null || true
}

append_decision() {
    local host url current_ip current_status current_total best_ip best_status best_score best_total improvement recommendation risk reason
    host="${1:-unknown}"
    url="${2:-unknown}"
    current_ip="${3:-unknown}"
    current_status="${4:-unknown}"
    current_total="${5:-0}"
    best_ip="${6:-none}"
    best_status="${7:-unknown}"
    best_score="${8:-0}"
    best_total="${9:-0}"
    improvement="${10:-0}"
    recommendation="${11:-observe}"
    risk="${12:-unknown}"
    reason="${13:-}"
    reason="$(printf '%s' "${reason}" | tr '\t\n' '  ')"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "${host}" "${url}" "${current_ip}" "${current_status}" "${current_total}" "${best_ip}" "${best_status}" \
        "${best_score}" "${best_total}" "${improvement}" "${recommendation}" "${risk}" "${reason}" \
        >> "${DECISIONS_FILE}" 2> /dev/null || true
}

make_temp_file() {
    local prefix dir tmp
    prefix="${1:-tmp}"
    dir="${2:-/tmp}"
    mkdir -p "${dir}" 2> /dev/null || dir="/tmp"
    tmp="$(mktemp "${dir%/}/${prefix}.XXXXXX" 2> /dev/null || true)"
    if [[ -n "${tmp}" ]]; then
        printf '%s
' "${tmp}"
        return 0
    fi
    mktemp "/tmp/${prefix}.XXXXXX" 2> /dev/null || true
}

# -----------------------------------------------------------------------------
# Candidate collection
# -----------------------------------------------------------------------------
manager_metric_ips_for_host() {
    local host
    host="${1:-}"
    [[ -r "${MANAGER_METRICS_FILE}" ]] || return 0
    awk -F'\t' -v h="${host}" 'NR > 1 && $3 == h && $7 != "" && $7 != "unknown" {print $7}' "${MANAGER_METRICS_FILE}" 2> /dev/null || true
}

local_dns_upstreams() {
    local selected
    selected="$(summary_value_from_file "${LOCAL_DNS_SUMMARY_FILE}" selected_upstreams)"
    if [[ -n "${selected}" && "${selected}" != "unknown" ]]; then
        split_words_to_lines "${selected}"
    fi
}

resolver_list() {
    {
        local_dns_upstreams || true
        split_words_to_lines "${RESOLVERS}"
    } | awk 'NF && !seen[$0]++ {print}'
}

dig_candidates_for_host() {
    local host resolver
    host="${1:-}"
    has_cmd dig || return 0
    dig +time=1 +tries=1 "${host}" +short A 2> /dev/null || true
    if [[ "${ENABLE_IPV6_CANDIDATES}" == "true" ]]; then
        dig +time=1 +tries=1 "${host}" +short AAAA 2> /dev/null || true
    fi
    while IFS= read -r resolver; do
        [[ -n "${resolver}" ]] || continue
        dig +time=1 +tries=1 @"${resolver}" "${host}" +short A 2> /dev/null || true
        if [[ "${ENABLE_IPV6_CANDIDATES}" == "true" ]]; then
            dig +time=1 +tries=1 @"${resolver}" "${host}" +short AAAA 2> /dev/null || true
        fi
    done < <(resolver_list)
}

getent_candidates_for_host() {
    local host
    host="${1:-}"
    has_cmd getent || return 0
    if [[ "${ENABLE_IPV6_CANDIDATES}" == "true" ]]; then
        getent ahosts "${host}" 2> /dev/null | awk '{print $1}' || true
    else
        getent ahostsv4 "${host}" 2> /dev/null | awk '{print $1}' || true
    fi
}

extra_candidates_for_host() {
    local host entry entry_host ips ip
    host="${1:-}"
    while IFS= read -r entry; do
        [[ -n "${entry}" ]] || continue
        entry_host="${entry%%=*}"
        ips="${entry#*=}"
        [[ "${entry_host}" == "${host}" ]] || continue
        ips="${ips//,/ }"
        while IFS= read -r ip; do
            [[ -n "${ip}" ]] && printf '%s
' "${ip}"
        done < <(split_words_to_lines "${ips}")
    done < <(split_words_to_lines "${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_EXTRA_CANDIDATES:-}")
}
collect_candidates_for_host() {
    local host
    host="${1:-}"
    {
        manager_metric_ips_for_host "${host}" || true
        getent_candidates_for_host "${host}" || true
        dig_candidates_for_host "${host}" || true
        extra_candidates_for_host "${host}" || true
    } | while IFS= read -r ip; do
        is_ip_candidate "${ip}" && printf '%s\n' "${ip}"
    done | awk -v max="${MAX_CANDIDATES_PER_HOST}" 'NF && !seen[$0]++ {print; c++; if (c >= max) exit}'
}

# -----------------------------------------------------------------------------
# Probe engine
# -----------------------------------------------------------------------------
curl_base_args() {
    local family
    family="$(curl_family_arg)"
    if [[ -n "${family}" ]]; then printf '%s\n' "${family}"; fi
    if [[ "${PROBE_PROXY_MODE}" == "direct" ]]; then
        printf '%s\n' '--noproxy'
        printf '%s\n' '*'
    fi
}

score_probe() {
    local status total_ms remote_ip expected_ip score
    status="${1:-unknown}"
    total_ms="${2:-0}"
    remote_ip="${3:-unknown}"
    expected_ip="${4:-}"
    score=0
    if [[ "${status}" == "ok" || "${status}" == "slow" ]]; then
        score=70
        if [[ "${remote_ip}" == "${expected_ip}" || "${expected_ip}" == "current" ]]; then
            score=$((score + 5))
        fi
        if [[ "${total_ms}" =~ ^[0-9]+$ ]]; then
            if ((total_ms > 0 && total_ms <= 200)); then
                score=$((score + 20))
            elif ((total_ms <= 500)); then
                score=$((score + 15))
            elif ((total_ms <= 1000)); then
                score=$((score + 8))
            elif ((total_ms <= 1500)); then
                score=$((score + 3))
            fi
        fi
    fi
    printf '%s' "${score}"
}

probe_url_current() {
    local url host klass output meta http_code content_type time_name time_connect time_tls time_start time_total remote_ip tls_verify curl_rc curl_exitcode
    local dns_ms tcp_ms tls_ms ttfb_ms total_ms expected status bottleneck score reason
    local -a args=()
    url="${1:-}"
    host="$(url_host "${url}")"
    klass="$(endpoint_class "${url}")"
    output="$(make_temp_file copilot-advisor-current "${PROBE_TMP_DIR}")"
    [[ -n "${output}" ]] || output="/dev/null"
    while IFS= read -r arg; do [[ -n "${arg}" ]] && args+=("${arg}"); done < <(curl_base_args)
    meta="$(LC_ALL=C curl "${args[@]}" -sS -o "${output}" \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_namelookup=%{time_namelookup}|time_connect=%{time_connect}|time_appconnect=%{time_appconnect}|time_starttransfer=%{time_starttransfer}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}|exitcode=%{exitcode}' \
        "${url}" 2> /dev/null)"
    curl_rc=$?
    safe_remove_temp_file "${output}"
    http_code="$(extract_field http_code "${meta}")"
    content_type="$(extract_field content_type "${meta}")"
    time_name="$(extract_field time_namelookup "${meta}")"
    time_connect="$(extract_field time_connect "${meta}")"
    time_tls="$(extract_field time_appconnect "${meta}")"
    time_start="$(extract_field time_starttransfer "${meta}")"
    time_total="$(extract_field time_total "${meta}")"
    remote_ip="$(extract_field remote_ip "${meta}")"
    tls_verify="$(extract_field ssl_verify_result "${meta}")"
    curl_exitcode="$(extract_field exitcode "${meta}")"
    dns_ms="$(float_ms "${time_name}")"
    tcp_ms="$(float_ms "${time_connect}")"
    tls_ms="$(float_ms "${time_tls}")"
    ttfb_ms="$(float_ms "${time_start}")"
    total_ms="$(float_ms "${time_total}")"
    expected="$(expected_status_label "${url}")"
    status="ok"
    reason="current-route;class=${klass}"
    if [[ "${curl_rc:-0}" -ne 0 && (-z "${http_code}" || "${http_code}" == "000") ]]; then
        status="fail"
        reason="curl-rc=${curl_rc};curl-exitcode=${curl_exitcode:-?}"
    elif [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
        status="fail"
        reason="no-http-response"
    elif [[ "${tls_verify}" != "0" ]]; then
        status="tls-fail"
        reason="tls-verify=${tls_verify:-?}"
    elif ! expected_status_ok "${url}" "${http_code}"; then
        status="unexpected-http"
        reason="expected=${expected}"
    elif [[ "${WARN_TOTAL_MS}" -gt 0 && "${total_ms}" =~ ^[0-9]+$ && "${total_ms}" -gt "${WARN_TOTAL_MS}" ]]; then
        status="slow"
        reason="total>${WARN_TOTAL_MS}ms"
    fi
    bottleneck="$(dominant_bottleneck "${dns_ms}" "${tcp_ms}" "${tls_ms}" "${ttfb_ms}" "${total_ms}" "${status}")"
    score="$(score_probe "${status}" "${total_ms}" "${remote_ip:-unknown}" "current")"
    append_metric "${url}" "${host}" "current" "current" "${http_code:-000}" "${remote_ip:-unknown}" "${dns_ms}" "${tcp_ms}" "${tls_ms}" "${ttfb_ms}" "${total_ms}" "${tls_verify:-?}" "${content_type:-none}" "${expected}" "${status}" "${score}" "${bottleneck}" "${reason}"
    printf '%s|%s|%s|%s|%s|%s|%s\n' "${status}" "${remote_ip:-unknown}" "${total_ms}" "${score}" "${bottleneck}" "${reason}" "${http_code:-000}"
}

probe_url_candidate() {
    local url ip host klass output resolve_value meta http_code content_type time_name time_connect time_tls time_start time_total remote_ip tls_verify curl_rc curl_exitcode
    local dns_ms tcp_ms tls_ms ttfb_ms total_ms expected status bottleneck score reason
    local -a args=()
    url="${1:-}"
    ip="${2:-}"
    host="$(url_host "${url}")"
    klass="$(endpoint_class "${url}")"
    resolve_value="$(curl_resolve_value "${host}" "${ip}")"
    output="$(make_temp_file copilot-advisor-candidate "${PROBE_TMP_DIR}")"
    [[ -n "${output}" ]] || output="/dev/null"
    while IFS= read -r arg; do [[ -n "${arg}" ]] && args+=("${arg}"); done < <(curl_base_args)
    args+=(--resolve "${resolve_value}")
    meta="$(LC_ALL=C curl "${args[@]}" -sS -o "${output}" \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_namelookup=%{time_namelookup}|time_connect=%{time_connect}|time_appconnect=%{time_appconnect}|time_starttransfer=%{time_starttransfer}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}|exitcode=%{exitcode}' \
        "${url}" 2> /dev/null)"
    curl_rc=$?
    safe_remove_temp_file "${output}"
    http_code="$(extract_field http_code "${meta}")"
    content_type="$(extract_field content_type "${meta}")"
    time_name="$(extract_field time_namelookup "${meta}")"
    time_connect="$(extract_field time_connect "${meta}")"
    time_tls="$(extract_field time_appconnect "${meta}")"
    time_start="$(extract_field time_starttransfer "${meta}")"
    time_total="$(extract_field time_total "${meta}")"
    remote_ip="$(extract_field remote_ip "${meta}")"
    tls_verify="$(extract_field ssl_verify_result "${meta}")"
    curl_exitcode="$(extract_field exitcode "${meta}")"
    dns_ms="$(float_ms "${time_name}")"
    tcp_ms="$(float_ms "${time_connect}")"
    tls_ms="$(float_ms "${time_tls}")"
    ttfb_ms="$(float_ms "${time_start}")"
    total_ms="$(float_ms "${time_total}")"
    expected="$(expected_status_label "${url}")"
    status="ok"
    reason="candidate-route;class=${klass}"
    if [[ "${curl_rc:-0}" -ne 0 && (-z "${http_code}" || "${http_code}" == "000") ]]; then
        status="fail"
        reason="curl-rc=${curl_rc};curl-exitcode=${curl_exitcode:-?}"
    elif [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
        status="fail"
        reason="no-http-response"
    elif [[ "${tls_verify}" != "0" ]]; then
        status="tls-fail"
        reason="tls-verify=${tls_verify:-?}"
    elif [[ "${STRICT_REMOTE_IP_MATCH}" == "true" && -n "${remote_ip}" && "${remote_ip}" != "${ip}" ]]; then
        status="remote-mismatch"
        reason="expected-remote=${ip};actual=${remote_ip}"
    elif ! expected_status_ok "${url}" "${http_code}"; then
        status="unexpected-http"
        reason="expected=${expected}"
    elif [[ "${WARN_TOTAL_MS}" -gt 0 && "${total_ms}" =~ ^[0-9]+$ && "${total_ms}" -gt "${WARN_TOTAL_MS}" ]]; then
        status="slow"
        reason="total>${WARN_TOTAL_MS}ms"
    fi
    bottleneck="$(dominant_bottleneck "${dns_ms}" "${tcp_ms}" "${tls_ms}" "${ttfb_ms}" "${total_ms}" "${status}")"
    score="$(score_probe "${status}" "${total_ms}" "${remote_ip:-unknown}" "${ip}")"
    append_metric "${url}" "${host}" "${ip}" "candidate" "${http_code:-000}" "${remote_ip:-unknown}" "${dns_ms}" "${tcp_ms}" "${tls_ms}" "${ttfb_ms}" "${total_ms}" "${tls_verify:-?}" "${content_type:-none}" "${expected}" "${status}" "${score}" "${bottleneck}" "${reason}"
    printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "${ip}" "${status}" "${remote_ip:-unknown}" "${total_ms}" "${score}" "${bottleneck}" "${reason}" "${http_code:-000}"
}

# -----------------------------------------------------------------------------
# Advisor decision engine
# -----------------------------------------------------------------------------
should_recommend_candidate() {
    local current_status current_total best_status best_total best_score threshold
    current_status="${1:-unknown}"
    current_total="${2:-0}"
    best_status="${3:-unknown}"
    best_total="${4:-0}"
    best_score="${5:-0}"
    is_nonnegative_int "${best_score}" || best_score=0
    is_nonnegative_int "${current_total}" || current_total=0
    is_nonnegative_int "${best_total}" || best_total=0
    [[ "${best_score}" -ge "${MIN_VALID_SCORE}" ]] || return 1
    [[ "${best_status}" == "ok" || "${best_status}" == "slow" ]] || return 1
    if [[ "${current_status}" != "ok" && "${current_status}" != "slow" ]]; then return 0; fi
    if ((current_total <= 0 || best_total <= 0)); then return 1; fi
    if ((current_total > best_total + SWITCH_MIN_IMPROVEMENT_MS)); then return 0; fi
    threshold=$((current_total * SWITCH_RATIO_PERCENT / 100))
    if ((best_total < threshold)); then return 0; fi
    return 1
}

advise_one_endpoint() {
    local url host current_record current_status current_ip current_total current_score current_bottleneck current_reason current_http
    local candidates candidate candidate_record candidate_ip candidate_status candidate_remote candidate_total candidate_score candidate_bottleneck candidate_reason candidate_http
    local best_ip best_status best_score best_total best_reason improvement recommendation risk reason
    url="${1:-}"
    if ! is_safe_https_url "${url}"; then
        log_warn "endpoint recusado por segurança/allowlist: ${url}"
        append_report "endpoint_rejected url=${url}"
        return 1
    fi

    host="$(url_host "${url}")"
    ENDPOINTS_TOTAL=$((ENDPOINTS_TOTAL + 1))
    log_info "advisory probe: ${url}"

    current_record="$(probe_url_current "${url}")"
    IFS='|' read -r current_status current_ip current_total current_score current_bottleneck current_reason current_http <<< "${current_record}"
    if [[ "${current_status}" != "ok" && "${current_status}" != "slow" ]]; then
        ENDPOINTS_CURRENT_FAILED=$((ENDPOINTS_CURRENT_FAILED + 1))
        RECOMMENDATIONS="$(join_recommendation "${RECOMMENDATIONS}" "current-route-failed-observe-candidates")"
    fi
    if [[ "${current_status}" == "ok" ]]; then
        ENDPOINTS_OK=$((ENDPOINTS_OK + 1))
    fi
    if [[ "${current_total}" =~ ^[0-9]+$ && "${current_total}" -gt "${GLOBAL_WORST_TOTAL_MS}" ]]; then
        GLOBAL_WORST_TOTAL_MS="${current_total}"
        GLOBAL_WORST_HOST="${host}"
    fi

    candidates="$(collect_candidates_for_host "${host}")"
    if [[ -z "${candidates}" ]]; then
        ENDPOINTS_NO_VALID_CANDIDATE=$((ENDPOINTS_NO_VALID_CANDIDATE + 1))
        append_decision "${host}" "${url}" "${current_ip:-unknown}" "${current_status}" "${current_total}" "none" "none" "0" "0" "0" "observe-no-candidates" "no-mutation" "no-candidates-collected;current=${current_status};http=${current_http}"
        append_report "decision host=${host} recommendation=observe-no-candidates reason=no-candidates-collected current_status=${current_status}"
        return 0
    fi

    best_ip=""
    best_status="none"
    best_score="0"
    best_total="0"
    best_reason=""
    while IFS= read -r candidate; do
        [[ -n "${candidate}" ]] || continue
        CANDIDATES_TOTAL=$((CANDIDATES_TOTAL + 1))
        candidate_record="$(probe_url_candidate "${url}" "${candidate}")"
        IFS='|' read -r candidate_ip candidate_status candidate_remote candidate_total candidate_score candidate_bottleneck candidate_reason candidate_http <<< "${candidate_record}"
        if is_nonnegative_int "${candidate_score}" && ((candidate_score >= MIN_VALID_SCORE)); then
            CANDIDATES_VALID=$((CANDIDATES_VALID + 1))
        fi
        if [[ -z "${best_ip}" ]] || { is_nonnegative_int "${candidate_score}" && is_nonnegative_int "${best_score}" && ((candidate_score > best_score)); } \
            || { [[ "${candidate_score}" == "${best_score}" ]] && is_nonnegative_int "${candidate_total}" && is_nonnegative_int "${best_total}" && ((candidate_total > 0 && (best_total == 0 || candidate_total < best_total))); }; then
            best_ip="${candidate_ip}"
            best_status="${candidate_status}"
            best_score="${candidate_score}"
            best_total="${candidate_total}"
            best_reason="${candidate_reason};http=${candidate_http};bottleneck=${candidate_bottleneck};remote=${candidate_remote}"
        fi
    done <<< "${candidates}"

    improvement=0
    if [[ "${current_total}" =~ ^[0-9]+$ && "${best_total}" =~ ^[0-9]+$ && "${current_total}" -gt "${best_total}" ]]; then
        improvement=$((current_total - best_total))
    fi
    if [[ "${improvement}" -gt "${GLOBAL_BEST_IMPROVEMENT_MS}" ]]; then
        GLOBAL_BEST_IMPROVEMENT_MS="${improvement}"
    fi

    risk="no-mutation;cdn-edge-observe-only"
    reason="current=${current_status}/${current_total}ms/${current_ip};current_score=${current_score};current_bottleneck=${current_bottleneck};current_reason=${current_reason};best=${best_status}/${best_total}ms/${best_ip};${best_reason}"
    if should_recommend_candidate "${current_status}" "${current_total}" "${best_status}" "${best_total}" "${best_score}"; then
        ENDPOINTS_WITH_BETTER_CANDIDATE=$((ENDPOINTS_WITH_BETTER_CANDIDATE + 1))
        recommendation="better-candidate-observe-only"
        RECOMMENDATIONS="$(join_recommendation "${RECOMMENDATIONS}" "review-copilot-route-advisor-decisions")"
        if [[ "${current_status}" != "ok" && "${current_status}" != "slow" ]]; then
            RECOMMENDATIONS="$(join_recommendation "${RECOMMENDATIONS}" "candidate-can-recover-current-failure")"
        fi
    elif [[ -z "${best_ip}" ]] || ! is_nonnegative_int "${best_score}" || ((best_score < MIN_VALID_SCORE)); then
        ENDPOINTS_NO_VALID_CANDIDATE=$((ENDPOINTS_NO_VALID_CANDIDATE + 1))
        recommendation="observe-no-valid-candidate"
    else
        recommendation="keep-current-observe"
    fi

    append_decision "${host}" "${url}" "${current_ip:-unknown}" "${current_status}" "${current_total}" "${best_ip:-none}" "${best_status}" "${best_score}" "${best_total}" "${improvement}" "${recommendation}" "${risk}" "${reason}"
    append_report "decision host=${host} recommendation=${recommendation} current=${current_ip:-unknown}/${current_status}/${current_total}ms best=${best_ip:-none}/${best_status}/${best_total}ms score=${best_score} improvement_ms=${improvement} risk=${risk}"
    return 0
}

run_advisor() {
    local url rc final_status
    if ! has_cmd curl; then
        log_warn "curl indisponível; advisor não pode executar probes HTTPS."
        write_status "failed"
        write_summary "failed" "no-curl"
        return 1
    fi

    if [[ "${PROBE_PROXY_MODE}" == "environment" ]]; then
        append_report "warning=proxy-environment-mode; curl --resolve may not represent final remote edge when a proxy handles CONNECT"
    fi

    while IFS= read -r url; do
        [[ -n "${url}" ]] || continue
        advise_one_endpoint "${url}"
        rc=$?
        if [[ "${rc}" -ne 0 ]]; then
            RECOMMENDATIONS="$(join_recommendation "${RECOMMENDATIONS}" "fix-advisor-endpoint-contract")"
        fi
    done < <(split_words_to_lines "${ENDPOINTS}")

    final_status="ok"
    if [[ "${ENDPOINTS_TOTAL}" -eq 0 ]]; then
        final_status="failed"
    elif [[ "${ENDPOINTS_CURRENT_FAILED}" -gt 0 || "${ENDPOINTS_NO_VALID_CANDIDATE}" -gt 0 ]]; then
        final_status="degraded"
    fi

    ADVISOR_STATUS="${final_status}"
    write_status "${final_status}"
    write_summary "${final_status}" "advisor-completed"
    if [[ "${final_status}" == "ok" ]]; then
        log_ok "Copilot Route Advisor concluído. endpoints=${ENDPOINTS_TOTAL}; better_candidates=${ENDPOINTS_WITH_BETTER_CANDIDATE}; recommendations=${RECOMMENDATIONS}"
    else
        log_warn "Copilot Route Advisor concluído com observações. status=${final_status}; current_failed=${ENDPOINTS_CURRENT_FAILED}; no_valid_candidate=${ENDPOINTS_NO_VALID_CANDIDATE}; recommendations=${RECOMMENDATIONS}"
    fi
    return 0
}

status_action() {
    local status_value
    status_value="$(read_first_line_from_file "${STATUS_FILE}")"
    [[ -n "${status_value}" ]] || status_value="unknown"
    log_info "status=${status_value}; summary=${SUMMARY_FILE}; metrics=${METRICS_FILE}; decisions=${DECISIONS_FILE}; report=${REPORT_FILE}"
    return 0
}

doctor_action() {
    local rc
    rc=0
    log_info "doctor: validando dependências e contrato do Copilot Route Advisor."
    for cmd in curl awk date mktemp; do
        if has_cmd "${cmd}"; then
            log_ok "doctor: ${cmd} disponível."
        else
            log_warn "doctor: ${cmd} indisponível."
            rc=1
        fi
    done
    if has_cmd dig; then log_ok "doctor: dig disponível."; else log_warn "doctor: dig ausente; candidatos virão de getent/manager/extras."; fi
    if has_cmd getent; then log_ok "doctor: getent disponível."; else log_warn "doctor: getent ausente; candidatos dependerão de dig/manager/extras."; fi
    if has_cmd flock; then log_ok "doctor: flock disponível."; else log_warn "doctor: flock ausente; lock será best-effort."; fi
    if [[ -r "${LOCAL_DNS_SUMMARY_FILE}" ]]; then
        log_ok "doctor: summary do DNS cache local legível: ${LOCAL_DNS_SUMMARY_FILE}"
    else
        log_warn "doctor: summary do DNS cache local ausente; normal se local-dns-cache ainda não rodou."
    fi
    if [[ -r "${LOCAL_DNS_STATUS_FILE}" ]]; then
        log_ok "doctor: status do DNS cache local legível: ${LOCAL_DNS_STATUS_FILE}"
    else
        log_warn "doctor: status do DNS cache local ausente; normal se local-dns-cache estiver desligado."
    fi
    if [[ -r "${MANAGER_SUMMARY_FILE}" ]]; then
        log_ok "doctor: summary do manager legível: ${MANAGER_SUMMARY_FILE}"
    else
        log_warn "doctor: summary do manager ausente; normal se o advisor foi executado isoladamente."
    fi
    if [[ "${PROBE_PROXY_MODE}" == "environment" ]]; then
        log_warn "doctor: proxy environment mode é observacional; --resolve pode não refletir o edge final se CONNECT for resolvido pelo proxy."
    fi
    if [[ "${INCLUDE_GITHUB_API}" == "true" ]]; then
        log_warn "doctor: INCLUDE_GITHUB_API=true; isto deve ser apenas observacional, pois api.github.com é governado pelo github-api-route-fix.sh."
    fi
    if [[ "${rc}" -eq 0 ]]; then
        ADVISOR_STATUS="ok"
        write_status "ok"
        write_summary "ok" "doctor"
    else
        ADVISOR_STATUS="failed"
        write_status "failed"
        write_summary "failed" "doctor"
    fi
    return "${rc}"
}

main_unlocked() {
    if [[ "${ACTION}" == "status" ]]; then
        log_info "Copilot Route Advisor status (v${SCRIPT_VERSION}); mode=${ADVISOR_MODE}."
        status_action
        return 0
    fi

    write_headers
    log_info "Copilot Route Advisor iniciado (v${SCRIPT_VERSION}); action=${ACTION}; mode=${ADVISOR_MODE}."
    log_debug "ENDPOINTS=${ENDPOINTS}"

    if [[ "${ADVISOR_MODE}" == "off" ]]; then
        ADVISOR_STATUS="off"
        write_status "off"
        write_summary "off" "mode-off"
        log_info "advisor desligado."
        return 0
    fi

    case "${ACTION}" in
        status)
            status_action
            return 0
            ;;
        doctor)
            doctor_action
            return $?
            ;;
        probe | start)
            run_advisor
            return $?
            ;;
    esac

    run_advisor
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
