#!/usr/bin/env bash
# =============================================================================
# local-dns-cache.sh — DevContainer Local DNS Cache Manager
# Version: v1.5.0
#
# Purpose:
#   Optional runtime-only DNS cache layer for DevContainers. Intended to be
#   called by post-start.sh when DEVCONTAINER_ENABLE_LOCAL_DNS_CACHE=true.
#
# Contract:
#   - Does not mutate Docker/DevContainer structure.
#   - Does not start application services.
#   - Starts only a bounded local DNS helper process, normally dnsmasq, bound to
#     loopback unless explicitly overridden.
#   - May rewrite /etc/resolv.conf content through tee, preserving inode.
#   - Never prompts for sudo; all privileged operations are non-interactive.
#   - Fails closed when mode=local/required and the DNS cache cannot be proven.
#   - In mode=auto, missing optional dependencies disable the layer without
#     failing post-start.
#
# Architecture:
#   applications → /etc/hosts → /etc/resolv.conf → 127.0.0.1:53
#     → dnsmasq cache → upstream DNS
#
# Notes:
#   - resolv.conf nameserver entries do not support custom ports. Therefore,
#     WRITE_RESOLV_CONF=true requires DNS_BIND_PORT=53.
#   - This script intentionally does not manage api.github.com routing. That is
#     delegated to github-api-route-fix.sh via /etc/hosts.
# =============================================================================

set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

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

sanitize_resolv_options() {
    # /etc/resolv.conf options are whitespace-separated tokens. Keep only a
    # conservative subset to prevent env-driven newline/config injection while
    # preserving the intended performance knobs: timeout, attempts and rotate.
    local raw token output
    raw="${1:-}"
    output=""

    for token in ${raw}; do
        case "${token}" in
            timeout:[0-9]* | attempts:[0-9]* | ndots:[0-9]* | rotate | edns0 | trust-ad | single-request | single-request-reopen) ;;
            *)
                continue
                ;;
        esac

        if [[ -z "${output}" ]]; then
            output="${token}"
        else
            output="${output} ${token}"
        fi
    done

    if [[ -z "${output}" ]]; then
        output="timeout:1 attempts:2 rotate"
    fi

    printf '%s' "${output}"
}

# -----------------------------------------------------------------------------
# Constants / sanitized config
# -----------------------------------------------------------------------------
SCRIPT_NAME="local-dns-cache.sh"
readonly SCRIPT_NAME
SCRIPT_VERSION="1.5.0"
readonly SCRIPT_VERSION

ACTION="${DEVCONTAINER_LOCAL_DNS_CACHE_ACTION:-start}"
case "${ACTION}" in
    start | status | stop | restart | probe | benchmark | doctor | health) : ;;
    *) ACTION="start" ;;
esac
readonly ACTION

DNS_MODE="${DEVCONTAINER_LOCAL_DNS_CACHE_MODE:-local}"
case "${DNS_MODE}" in
    off | disabled | false) DNS_MODE="off" ;;
    auto) DNS_MODE="auto" ;;
    local | required | true | on | enabled) DNS_MODE="local" ;;
    *) DNS_MODE="local" ;;
esac
readonly DNS_MODE

DNS_BIND_ADDRESS="${DEVCONTAINER_LOCAL_DNS_BIND_ADDRESS:-127.0.0.1}"
readonly DNS_BIND_ADDRESS
DNS_BIND_PORT="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_BIND_PORT:-53}" 53 1 65535)"
readonly DNS_BIND_PORT
DNS_UPSTREAMS="${DEVCONTAINER_LOCAL_DNS_UPSTREAMS:-1.1.1.1 1.0.0.1 8.8.8.8 8.8.4.4 9.9.9.9 149.112.112.112}"
readonly DNS_UPSTREAMS
DNS_UPSTREAM_SELECTION="${DEVCONTAINER_LOCAL_DNS_UPSTREAM_SELECTION:-static}"
case "${DNS_UPSTREAM_SELECTION}" in
    static | ranked) : ;;
    *) DNS_UPSTREAM_SELECTION="static" ;;
esac
readonly DNS_UPSTREAM_SELECTION
DNS_BENCHMARK_HOSTS="${DEVCONTAINER_LOCAL_DNS_BENCHMARK_HOSTS:-api.github.com github.com copilot-proxy.githubusercontent.com api.githubcopilot.com}"
readonly DNS_BENCHMARK_HOSTS
DNS_OPTIONS_RAW="${DEVCONTAINER_LOCAL_DNS_RESOLV_OPTIONS:-timeout:1 attempts:2 rotate}"
DNS_OPTIONS="$(sanitize_resolv_options "${DNS_OPTIONS_RAW}")"
readonly DNS_OPTIONS_RAW DNS_OPTIONS
DNS_CACHE_SIZE="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_CACHE_SIZE:-10000}" 10000 0 1000000)"
readonly DNS_CACHE_SIZE
DNS_MIN_CACHE_TTL="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_MIN_CACHE_TTL:-0}" 0 0 86400)"
readonly DNS_MIN_CACHE_TTL
DNS_MAX_CACHE_TTL="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_MAX_CACHE_TTL:-300}" 300 0 86400)"
readonly DNS_MAX_CACHE_TTL
DNS_NEG_TTL="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_NEG_TTL:-30}" 30 0 3600)"
readonly DNS_NEG_TTL
# dnsmasq defaults to 150 concurrent forwarded DNS queries. Keep the same
# conservative default, but make it explicit and bounded for diagnostics.
DNS_FORWARD_MAX="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_FORWARD_MAX:-150}" 150 1 10000)"
readonly DNS_FORWARD_MAX

RUNTIME_DIR="${DEVCONTAINER_LOCAL_DNS_RUNTIME_DIR:-/tmp/devcontainer-network}"
readonly RUNTIME_DIR
DNSMASQ_CONF="${DEVCONTAINER_LOCAL_DNS_DNSMASQ_CONF:-${RUNTIME_DIR}/dnsmasq.conf}"
readonly DNSMASQ_CONF
DNSMASQ_PID_FILE="${DEVCONTAINER_LOCAL_DNS_PID_FILE:-${RUNTIME_DIR}/dnsmasq.pid}"
readonly DNSMASQ_PID_FILE
DNSMASQ_LOG_FILE="${DEVCONTAINER_LOCAL_DNS_LOG_FILE:-${RUNTIME_DIR}/dnsmasq.log}"
readonly DNSMASQ_LOG_FILE
LOCK_FILE="${DEVCONTAINER_LOCAL_DNS_LOCK_FILE:-${RUNTIME_DIR}/local-dns-cache.lock}"
readonly LOCK_FILE
LOCK_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_LOCK_WAIT_SECONDS:-20}" 20 0 300)"
readonly LOCK_WAIT_SECONDS
REPORT_FILE="${DEVCONTAINER_LOCAL_DNS_REPORT_FILE:-/tmp/devcontainer-local-dns-cache.report}"
readonly REPORT_FILE
STATUS_FILE="${DEVCONTAINER_LOCAL_DNS_STATUS_FILE:-/tmp/devcontainer-local-dns-cache.status}"
readonly STATUS_FILE
SUMMARY_FILE="${DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.summary}"
readonly SUMMARY_FILE
METRICS_FILE="${DEVCONTAINER_LOCAL_DNS_METRICS_FILE:-/tmp/devcontainer-local-dns-cache.metrics.tsv}"
readonly METRICS_FILE
RESOLV_BACKUP_FILE="${DEVCONTAINER_LOCAL_DNS_RESOLV_BACKUP_FILE:-/tmp/devcontainer-local-dns-cache.resolv.conf.backup}"
readonly RESOLV_BACKUP_FILE
RESOLV_MANAGED_MARKER="devcontainer-local-dns-cache managed"
readonly RESOLV_MANAGED_MARKER

PROBE_HOST="${DEVCONTAINER_LOCAL_DNS_PROBE_HOST:-github.com}"
readonly PROBE_HOST
PROBE_TIMEOUT="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_PROBE_TIMEOUT:-3}" 3 1 30)"
readonly PROBE_TIMEOUT
WRITE_RESOLV_CONF="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_WRITE_RESOLV_CONF:-true}" true)"
readonly WRITE_RESOLV_CONF
RESTORE_RESOLV_CONF_ON_STOP="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_RESTORE_RESOLV_CONF_ON_STOP:-true}" true)"
readonly RESTORE_RESOLV_CONF_ON_STOP
ENABLE_IPV6_UPSTREAMS="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_ENABLE_IPV6_UPSTREAMS:-false}" false)"
readonly ENABLE_IPV6_UPSTREAMS
ALLOW_NON_LOOPBACK_BIND="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_ALLOW_NON_LOOPBACK_BIND:-false}" false)"
readonly ALLOW_NON_LOOPBACK_BIND
ALLOW_LOOPBACK_UPSTREAMS="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_ALLOW_LOOPBACK_UPSTREAMS:-false}" false)"
readonly ALLOW_LOOPBACK_UPSTREAMS
READ_ETC_HOSTS="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_READ_ETC_HOSTS:-false}" false)"
readonly READ_ETC_HOSTS
LOG_QUERIES="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_LOG_QUERIES:-false}" false)"
readonly LOG_QUERIES
STRICT_PORT_CHECK="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_STRICT_PORT_CHECK:-true}" true)"
readonly STRICT_PORT_CHECK
STOP_DNS_REBIND="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_STOP_DNS_REBIND:-true}" true)"
readonly STOP_DNS_REBIND
DNS_ALL_SERVERS="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_ALL_SERVERS:-false}" false)"
readonly DNS_ALL_SERVERS
DNS_STRICT_ORDER="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_STRICT_ORDER:-false}" false)"
readonly DNS_STRICT_ORDER
DNS_USE_STALE_CACHE="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_USE_STALE_CACHE:-false}" false)"
readonly DNS_USE_STALE_CACHE
DNS_USE_STALE_CACHE_TTL="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_USE_STALE_CACHE_TTL:-60}" 60 0 86400)"
readonly DNS_USE_STALE_CACHE_TTL
DNS_FAST_RETRY="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_FAST_RETRY:-false}" false)"
readonly DNS_FAST_RETRY
DNS_FAST_RETRY_INITIAL_MS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_FAST_RETRY_INITIAL_MS:-1000}" 1000 100 10000)"
readonly DNS_FAST_RETRY_INITIAL_MS
DNS_FAST_RETRY_WINDOW_MS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_FAST_RETRY_WINDOW_MS:-10000}" 10000 1000 60000)"
readonly DNS_FAST_RETRY_WINDOW_MS
DNS_VALIDATE_CONFIG="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_VALIDATE_CONFIG:-true}" true)"
readonly DNS_VALIDATE_CONFIG
TAKEOVER_STALE_DNSMASQ="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_TAKEOVER_STALE_DNSMASQ:-true}" true)"
readonly TAKEOVER_STALE_DNSMASQ
DNSMASQ_STOP_WAIT_MS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_STOP_WAIT_MS:-2000}" 2000 100 30000)"
readonly DNSMASQ_STOP_WAIT_MS
PREFER_UNPRIVILEGED_DNSMASQ="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_PREFER_UNPRIVILEGED_DNSMASQ:-false}" false)"
readonly PREFER_UNPRIVILEGED_DNSMASQ
DNSMASQ_START_MODE="${DEVCONTAINER_LOCAL_DNS_START_MODE:-auto}"
case "${DNSMASQ_START_MODE}" in
    auto | root | user) : ;;
    *) DNSMASQ_START_MODE="auto" ;;
esac
readonly DNSMASQ_START_MODE
STOP_BY_SOCKET_OWNER="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_STOP_BY_SOCKET_OWNER:-true}" true)"
readonly STOP_BY_SOCKET_OWNER
REPAIR_ON_PROBE_FAILURE="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_REPAIR_ON_PROBE_FAILURE:-true}" true)"
readonly REPAIR_ON_PROBE_FAILURE

# Persistent upstream ranking and health/staleness controls.
RANKING_FILE="${DEVCONTAINER_LOCAL_DNS_RANKING_FILE:-${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/devcontainer/network/dns-upstream-ranking.tsv}"
readonly RANKING_FILE
RANKING_STATE_FILE="${DEVCONTAINER_LOCAL_DNS_RANKING_STATE_FILE:-${RUNTIME_DIR}/dns-upstream-ranking.state}"
readonly RANKING_STATE_FILE
RANKING_LOCK_FILE="${DEVCONTAINER_LOCAL_DNS_RANKING_LOCK_FILE:-${RANKING_FILE}.lock}"
readonly RANKING_LOCK_FILE
RANKING_MAX_AGE_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_RANKING_MAX_AGE_SECONDS:-86400}" 86400 60 2592000)"
readonly RANKING_MAX_AGE_SECONDS
RANKING_REBENCHMARK_MIN_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_REBENCHMARK_MIN_SECONDS:-900}" 900 0 86400)"
readonly RANKING_REBENCHMARK_MIN_SECONDS
RANKING_HYSTERESIS_SCORE_MARGIN="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_RANKING_HYSTERESIS_SCORE_MARGIN:-5000}" 5000 0 10000000)"
readonly RANKING_HYSTERESIS_SCORE_MARGIN
RANKING_FORCE_REBENCHMARK="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_FORCE_REBENCHMARK:-false}" false)"
readonly RANKING_FORCE_REBENCHMARK
RANKING_REBENCHMARK_ON_START="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_REBENCHMARK_ON_START:-true}" true)"
readonly RANKING_REBENCHMARK_ON_START
STATUS_STALE_MAX_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_STATUS_STALE_MAX_SECONDS:-0}" 0 0 604800)"
readonly STATUS_STALE_MAX_SECONDS
SELECTED_UPSTREAMS=""
UPSTREAM_COUNT="0"
LOCAL_PROBE_STATUS="unknown"
SYSTEM_PROBE_STATUS="unknown"
RESOLV_CONF_STATUS="unknown"
RANKING_SOURCE="unknown"
RANKING_STALE="unknown"
RANKING_REASON="unknown"
RANKING_LAST_BENCHMARK_AT="0"
DNSMASQ_PID_EFFECTIVE="unknown"
DNSMASQ_PROCESS_STATUS="unknown"
DNSMASQ_PORT_STATUS="unknown"
RESOLV_CONF_HEALTH="unknown"
RESOLV_CONF_NAMESERVERS="unknown"
STATUS_STALE="unknown"
STATUS_STALE_REASON="unknown"
CONTAINER_FINGERPRINT="unknown"

# -----------------------------------------------------------------------------
# Logging / status helpers
# -----------------------------------------------------------------------------
ts() { date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date; }

now_epoch() { date '+%s' 2> /dev/null || printf '0'; }

file_mtime_epoch() {
    local target
    target="${1:-}"
    [[ -n "${target}" && -e "${target}" ]] || {
        printf '0'
        return 0
    }
    stat -c '%Y' "${target}" 2> /dev/null || printf '0'
}

container_fingerprint() {
    # /proc/1/stat field 22 is the start time in clock ticks. It changes when
    # the container init process is recreated, making it a useful stale-status
    # guard for /tmp summaries that may survive unusual restart flows.
    awk '{print $22}' /proc/1/stat 2> /dev/null || printf 'unknown'
}

summary_value_from_file() {
    local file key
    file="${1:-}"
    key="${2:-}"
    [[ -r "${file}" && -n "${key}" ]] || return 0
    awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}' "${file}" 2> /dev/null
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

remove_file_privileged() {
    local target
    target="${1:-}"
    [[ -n "${target}" ]] || return 1
    rm -f -- "${target}" 2> /dev/null && return 0
    safe_sudo rm -f -- "${target}" 2> /dev/null && return 0
    return 1
}

truncate_file_privileged() {
    local target
    target="${1:-}"
    [[ -n "${target}" ]] || return 1
    ensure_parent_dir "${target}"
    : > "${target}" 2> /dev/null && return 0
    # Use tee with an empty stdin instead of sh -c, avoiding nested-shell
    # quoting and ShellCheck SC2016 false positives.
    safe_sudo tee "${target}" > /dev/null 2> /dev/null < /dev/null && return 0
    return 1
}

log_info() { printf '%s\n' "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { printf '%s\n' "⚠️  [${SCRIPT_NAME}] $*"; }
log_ok() { printf '%s\n' "✅ [${SCRIPT_NAME}] $*"; }
log_debug() {
    if [[ "${DEVCONTAINER_VERBOSE_NETWORK:-false}" == "true" ]]; then
        printf '%s\n' "🔎 [${SCRIPT_NAME}] $*" >&2
    fi
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

write_report_header() {
    ensure_parent_dir "${REPORT_FILE}"
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'run_id=%s\n' "$(now_epoch)-$$"
        printf 'container_fingerprint=%s\n' "$(container_fingerprint)"
        printf 'action=%s\n' "${ACTION}"
        printf 'mode=%s\n' "${DNS_MODE}"
        printf 'bind_address=%s\n' "${DNS_BIND_ADDRESS}"
        printf 'bind_port=%s\n' "${DNS_BIND_PORT}"
        printf 'upstreams=%s\n' "${DNS_UPSTREAMS}"
        printf 'upstream_selection=%s\n' "${DNS_UPSTREAM_SELECTION}"
        printf 'benchmark_hosts=%s\n' "${DNS_BENCHMARK_HOSTS}"
        printf 'cache_size=%s\n' "${DNS_CACHE_SIZE}"
        printf 'min_cache_ttl=%s\n' "${DNS_MIN_CACHE_TTL}"
        printf 'max_cache_ttl=%s\n' "${DNS_MAX_CACHE_TTL}"
        printf 'neg_ttl=%s\n' "${DNS_NEG_TTL}"
        printf 'dns_forward_max=%s\n' "${DNS_FORWARD_MAX}"
        printf 'probe_host=%s\n' "${PROBE_HOST}"
        printf 'write_resolv_conf=%s\n' "${WRITE_RESOLV_CONF}"
        printf 'read_etc_hosts=%s\n' "${READ_ETC_HOSTS}"
        printf 'log_queries=%s\n' "${LOG_QUERIES}"
        printf 'all_servers=%s\n' "${DNS_ALL_SERVERS}"
        printf 'strict_order=%s\n' "${DNS_STRICT_ORDER}"
        printf 'use_stale_cache=%s\n' "${DNS_USE_STALE_CACHE}"
        printf 'takeover_stale_dnsmasq=%s\n' "${TAKEOVER_STALE_DNSMASQ}"
        printf 'dnsmasq_start_mode=%s\n' "${DNSMASQ_START_MODE}"
        printf 'prefer_unprivileged_dnsmasq=%s\n' "${PREFER_UNPRIVILEGED_DNSMASQ}"
        printf 'repair_on_probe_failure=%s\n' "${REPAIR_ON_PROBE_FAILURE}"
        printf 'ranking_file=%s\n' "${RANKING_FILE}"
        printf 'ranking_max_age_seconds=%s\n' "${RANKING_MAX_AGE_SECONDS}"
        printf 'ranking_rebenchmark_min_seconds=%s\n' "${RANKING_REBENCHMARK_MIN_SECONDS}"
        printf 'ranking_hysteresis_score_margin=%s\n' "${RANKING_HYSTERESIS_SCORE_MARGIN}"
        printf 'ranking_force_rebenchmark=%s\n' "${RANKING_FORCE_REBENCHMARK}"
        printf 'ranking_rebenchmark_on_start=%s\n' "${RANKING_REBENCHMARK_ON_START}"
        printf '\n'
    } > "${REPORT_FILE}" 2> /dev/null || true
}
write_metrics_header() {
    printf '%s\n' 'timestamp	probe_kind	host	server	port	rc	answer_count	query_ms	answers' | safe_write_file "${METRICS_FILE}" 0644 || true
}
append_metric() {
    local kind host server port rc answer_count query_ms answers
    kind="${1:-unknown}"
    host="${2:-unknown}"
    server="${3:-system}"
    port="${4:-}"
    rc="${5:-1}"
    answer_count="${6:-0}"
    query_ms="${7:-0}"
    answers="${8:-}"
    answers="$(printf '%s' "${answers}" | tr '\t\n' '  ')"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$(ts)" "${kind}" "${host}" "${server}" "${port}" "${rc}" "${answer_count}" "${query_ms}" "${answers}" \
        >> "${METRICS_FILE}" 2> /dev/null || true
}

collect_runtime_health() {
    local pid nameservers summary_status summary_fp current_fp status_mtime age now pid_cmdline
    pid="$(read_dnsmasq_pid)"
    DNSMASQ_PID_EFFECTIVE="${pid:-none}"
    DNSMASQ_PROCESS_STATUS="stopped"

    if [[ -n "${pid}" ]]; then
        if pid_is_alive "${pid}"; then
            if managed_dnsmasq_pid_is_alive; then
                DNSMASQ_PROCESS_STATUS="running-managed"
            elif process_is_dnsmasq "${pid}"; then
                DNSMASQ_PROCESS_STATUS="running-stale-pidfile"
            else
                DNSMASQ_PROCESS_STATUS="pidfile-non-dnsmasq"
            fi
        else
            DNSMASQ_PROCESS_STATUS="stale-pidfile-dead"
        fi
    elif dnsmasq_is_running; then
        DNSMASQ_PROCESS_STATUS="running-managed-no-pidfile"
    fi

    if [[ "${STRICT_PORT_CHECK}" == "true" ]] && port_in_use "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
        case "${DNSMASQ_PROCESS_STATUS}" in
            running-managed | running-managed-no-pidfile | running-stale-pidfile)
                DNSMASQ_PORT_STATUS="bound-dnsmasq"
                ;;
            *)
                DNSMASQ_PORT_STATUS="bound-unmanaged"
                ;;
        esac
    else
        DNSMASQ_PORT_STATUS="free-or-unobserved"
    fi

    if [[ -r /etc/resolv.conf ]]; then
        nameservers="$(awk '$1 == "nameserver" {printf "%s%s", sep, $2; sep=" "}' /etc/resolv.conf 2> /dev/null || true)"
        RESOLV_CONF_NAMESERVERS="${nameservers:-none}"
        if verify_resolv_conf_points_to_cache; then
            if resolv_conf_is_managed; then
                RESOLV_CONF_HEALTH="managed-points-to-cache"
            else
                RESOLV_CONF_HEALTH="points-to-cache-unmanaged"
            fi
        elif resolv_conf_is_managed; then
            RESOLV_CONF_HEALTH="managed-stale-not-pointing-to-cache"
        else
            RESOLV_CONF_HEALTH="points-elsewhere"
        fi
    else
        RESOLV_CONF_NAMESERVERS="unreadable"
        RESOLV_CONF_HEALTH="unreadable"
    fi

    current_fp="$(container_fingerprint)"
    CONTAINER_FINGERPRINT="${current_fp:-unknown}"
    summary_status="$(summary_value_from_file "${SUMMARY_FILE}" status)"
    summary_fp="$(summary_value_from_file "${SUMMARY_FILE}" container_fingerprint)"
    STATUS_STALE="false"
    STATUS_STALE_REASON="fresh-or-unavailable"

    if [[ "${summary_status}" == "ok" ]]; then
        if [[ "${WRITE_RESOLV_CONF}" == "true" && "${RESOLV_CONF_HEALTH}" != *"points-to-cache"* ]]; then
            STATUS_STALE="true"
            STATUS_STALE_REASON="summary-ok-but-resolv-conf-not-pointing-to-cache"
        elif [[ "${DNSMASQ_PROCESS_STATUS}" != running-* ]]; then
            STATUS_STALE="true"
            STATUS_STALE_REASON="summary-ok-but-dnsmasq-not-running"
        fi
    fi

    if [[ -n "${summary_fp}" && "${summary_fp}" != "${current_fp}" ]]; then
        STATUS_STALE="true"
        STATUS_STALE_REASON="summary-from-different-container-init"
    fi

    if [[ "${STATUS_STALE_MAX_SECONDS}" -gt 0 && -e "${SUMMARY_FILE}" ]]; then
        now="$(now_epoch)"
        status_mtime="$(file_mtime_epoch "${SUMMARY_FILE}")"
        age=$((now - status_mtime))
        if ((age > STATUS_STALE_MAX_SECONDS)); then
            STATUS_STALE="true"
            STATUS_STALE_REASON="summary-age-exceeded-${STATUS_STALE_MAX_SECONDS}s"
        fi
    fi

    if [[ -n "${pid}" && -r "/proc/${pid}/cmdline" ]]; then
        pid_cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2> /dev/null || true)"
        append_report "dnsmasq_runtime pid=${pid} status=${DNSMASQ_PROCESS_STATUS} port=${DNSMASQ_PORT_STATUS} cmdline=${pid_cmdline}"
    else
        append_report "dnsmasq_runtime pid=${DNSMASQ_PID_EFFECTIVE} status=${DNSMASQ_PROCESS_STATUS} port=${DNSMASQ_PORT_STATUS}"
    fi
    append_report "resolv_conf_health=${RESOLV_CONF_HEALTH} nameservers=${RESOLV_CONF_NAMESERVERS} status_stale=${STATUS_STALE} stale_reason=${STATUS_STALE_REASON}"
}

write_summary() {
    local status reason
    status="${1:-unknown}"
    reason="${2:-none}"
    collect_runtime_health
    if [[ "${status}" != "ok" && "${status}" != "stale" ]]; then
        STATUS_STALE="false"
        STATUS_STALE_REASON="not-applicable-for-${status}"
    fi
    {
        printf 'status=%s\n' "${status}"
        printf 'reason=%s\n' "${reason}"
        printf 'script_version=%s\n' "${SCRIPT_VERSION}"
        printf 'container_fingerprint=%s\n' "${CONTAINER_FINGERPRINT}"
        printf 'mode=%s\n' "${DNS_MODE}"
        printf 'action=%s\n' "${ACTION}"
        printf 'bind_address=%s\n' "${DNS_BIND_ADDRESS}"
        printf 'bind_port=%s\n' "${DNS_BIND_PORT}"
        printf 'upstream_selection=%s\n' "${DNS_UPSTREAM_SELECTION}"
        printf 'selected_upstreams=%s\n' "${SELECTED_UPSTREAMS:-unknown}"
        printf 'upstream_count=%s\n' "${UPSTREAM_COUNT:-0}"
        printf 'ranking_source=%s\n' "${RANKING_SOURCE:-unknown}"
        printf 'ranking_stale=%s\n' "${RANKING_STALE:-unknown}"
        printf 'ranking_reason=%s\n' "${RANKING_REASON:-unknown}"
        printf 'ranking_file=%s\n' "${RANKING_FILE}"
        printf 'ranking_last_benchmark_at=%s\n' "${RANKING_LAST_BENCHMARK_AT:-0}"
        printf 'dns_forward_max=%s\n' "${DNS_FORWARD_MAX}"
        printf 'dnsmasq_start_mode=%s\n' "${DNSMASQ_START_MODE}"
        printf 'dnsmasq_pid=%s\n' "${DNSMASQ_PID_EFFECTIVE}"
        printf 'dnsmasq_process_status=%s\n' "${DNSMASQ_PROCESS_STATUS}"
        printf 'dnsmasq_port_status=%s\n' "${DNSMASQ_PORT_STATUS}"
        printf 'local_probe_status=%s\n' "${LOCAL_PROBE_STATUS}"
        printf 'system_probe_status=%s\n' "${SYSTEM_PROBE_STATUS}"
        printf 'resolv_conf_status=%s\n' "${RESOLV_CONF_STATUS}"
        printf 'resolv_conf_health=%s\n' "${RESOLV_CONF_HEALTH}"
        printf 'resolv_conf_nameservers=%s\n' "${RESOLV_CONF_NAMESERVERS}"
        printf 'status_stale=%s\n' "${STATUS_STALE}"
        printf 'status_stale_reason=%s\n' "${STATUS_STALE_REASON}"
        printf 'dnsmasq_conf=%s\n' "${DNSMASQ_CONF}"
        printf 'dnsmasq_pid_file=%s\n' "${DNSMASQ_PID_FILE}"
        printf 'dnsmasq_log_file=%s\n' "${DNSMASQ_LOG_FILE}"
        printf 'report=%s\n' "${REPORT_FILE}"
        printf 'metrics=%s\n' "${METRICS_FILE}"
        printf 'completed_at=%s\n' "$(ts)"
    } | safe_write_file "${SUMMARY_FILE}" 0644 || true
}
# -----------------------------------------------------------------------------
# Generic helpers
# -----------------------------------------------------------------------------
has_cmd() { command -v "$1" > /dev/null 2>&1; }

safe_sudo() {
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
    addr = ipaddress.IPv6Address(sys.argv[1])
except Exception:
    sys.exit(1)
if addr.ipv4_mapped is not None:
    sys.exit(1)
sys.exit(0)
PY
        return $?
    fi
    [[ "$1" =~ ^[0-9A-Fa-f:]+$ && "$1" != ::ffff:* ]]
}

is_ipv4_loopback() {
    [[ "${1:-}" =~ ^127\. ]]
}

is_ipv6_loopback() {
    [[ "${1:-}" == "::1" ]]
}

is_loopback_address() {
    is_ipv4_loopback "$1" || is_ipv6_loopback "$1"
}

is_valid_bind_address() {
    if is_loopback_address "$1"; then
        return 0
    fi
    [[ "${ALLOW_NON_LOOPBACK_BIND}" == "true" ]] || return 1
    is_ipv4 "$1" || is_ipv6_literal "$1"
}

is_valid_nameserver() {
    if is_ipv4 "$1"; then
        if is_ipv4_loopback "$1" && [[ "${ALLOW_LOOPBACK_UPSTREAMS}" != "true" ]]; then
            return 1
        fi
        return 0
    fi
    if [[ "${ENABLE_IPV6_UPSTREAMS}" == "true" ]] && is_ipv6_literal "$1"; then
        if is_ipv6_loopback "$1" && [[ "${ALLOW_LOOPBACK_UPSTREAMS}" != "true" ]]; then
            return 1
        fi
        return 0
    fi
    return 1
}

is_safe_hostname() {
    local h
    h="${1:-}"
    [[ ${#h} -ge 1 && ${#h} -le 253 ]] || return 1
    [[ "${h}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] || return 1
    [[ "${h}" != *..* ]] || return 1
    [[ "${h}" == *.* ]] || return 1
    return 0
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
    mktemp "/tmp/${prefix}.XXXXXX" 2> /dev/null || true
}

pid_is_alive() {
    local pid
    pid="${1:-}"
    [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
    kill -0 "${pid}" 2> /dev/null
}

read_dnsmasq_pid() {
    if [[ -s "${DNSMASQ_PID_FILE}" ]]; then
        awk 'NR==1{print $1}' "${DNSMASQ_PID_FILE}" 2> /dev/null
    fi
}

process_cmdline_contains() {
    local pid needle cmdline
    pid="${1:-}"
    needle="${2:-}"
    [[ "${pid}" =~ ^[0-9]+$ && -n "${needle}" ]] || return 1
    [[ -r "/proc/${pid}/cmdline" ]] || return 1
    cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2> /dev/null || true)"
    [[ "${cmdline}" == *"${needle}"* ]]
}

managed_dnsmasq_pid_is_alive() {
    local pid
    pid="$(read_dnsmasq_pid)"
    pid_is_alive "${pid}" || return 1
    process_cmdline_contains "${pid}" "dnsmasq" || return 1
    process_cmdline_contains "${pid}" "${DNSMASQ_CONF}" || return 1
}

dnsmasq_is_running() {
    if managed_dnsmasq_pid_is_alive; then
        return 0
    fi
    if has_cmd pgrep; then
        pgrep -f "dnsmasq.*${DNSMASQ_CONF}" > /dev/null 2>&1
        return $?
    fi
    return 1
}

port_in_use() {
    local address port line
    address="${1:-127.0.0.1}"
    port="${2:-53}"
    if has_cmd ss; then
        while IFS= read -r line; do
            [[ "${line}" == *":${port} "* || "${line}" == *":${port}" ]] || continue
            [[ "${line}" == *"${address}:${port}"* || "${line}" == *"*:${port}"* || "${line}" == *"[::]:${port}"* ]] && return 0
        done < <(ss -H -lntu 2> /dev/null || true)
    fi
    return 1
}

# -----------------------------------------------------------------------------
# Upstream selection / benchmark / persistent ranking
# -----------------------------------------------------------------------------
ensure_ranking_file_unlocked() {
    ensure_parent_dir "${RANKING_FILE}"
    if [[ ! -s "${RANKING_FILE}" ]]; then
        printf '%s\n' 'upstream	success_count	failure_count	last_success_epoch	last_failure_epoch	avg_ms	min_ms	p95_ms	rank_score	selected_count	last_selected_epoch' > "${RANKING_FILE}" 2> /dev/null || return 1
        chmod 0600 "${RANKING_FILE}" 2> /dev/null || true
    fi
    return 0
}

with_ranking_lock() {
    local fn
    fn="${1:-}"
    shift || true
    ensure_parent_dir "${RANKING_LOCK_FILE}"
    if has_cmd flock; then
        (
            flock -x -w "${LOCK_WAIT_SECONDS}" 9 || exit 98
            "${fn}" "$@"
        ) 9> "${RANKING_LOCK_FILE}"
        return $?
    fi
    "${fn}" "$@"
}

write_ranking_state() {
    {
        printf 'ranking_source=%s\n' "${RANKING_SOURCE:-unknown}"
        printf 'ranking_stale=%s\n' "${RANKING_STALE:-unknown}"
        printf 'ranking_reason=%s\n' "${RANKING_REASON:-unknown}"
        printf 'ranking_last_benchmark_at=%s\n' "${RANKING_LAST_BENCHMARK_AT:-0}"
        printf 'selected_upstreams=%s\n' "${SELECTED_UPSTREAMS:-}"
        printf 'upstream_count=%s\n' "${UPSTREAM_COUNT:-0}"
    } | safe_write_file "${RANKING_STATE_FILE}" 0600 || true
}

load_ranking_state() {
    [[ -r "${RANKING_STATE_FILE}" ]] || return 0
    RANKING_SOURCE="$(summary_value_from_file "${RANKING_STATE_FILE}" ranking_source)"
    RANKING_STALE="$(summary_value_from_file "${RANKING_STATE_FILE}" ranking_stale)"
    RANKING_REASON="$(summary_value_from_file "${RANKING_STATE_FILE}" ranking_reason)"
    RANKING_LAST_BENCHMARK_AT="$(summary_value_from_file "${RANKING_STATE_FILE}" ranking_last_benchmark_at)"
    [[ -n "${RANKING_SOURCE}" ]] || RANKING_SOURCE="unknown"
    [[ -n "${RANKING_STALE}" ]] || RANKING_STALE="unknown"
    [[ -n "${RANKING_REASON}" ]] || RANKING_REASON="unknown"
    [[ -n "${RANKING_LAST_BENCHMARK_AT}" ]] || RANKING_LAST_BENCHMARK_AT="0"
}

valid_upstreams_static() {
    local upstream
    for upstream in ${DNS_UPSTREAMS}; do
        if is_valid_nameserver "${upstream}"; then
            printf '%s\n' "${upstream}"
        else
            append_report "ignored_invalid_upstream=${upstream}"
        fi
    done
}

benchmark_one_upstream() {
    local upstream host out rc answer_count query_ms answers
    upstream="${1:-}"
    host="${2:-${PROBE_HOST}}"
    is_valid_nameserver "${upstream}" || return 1
    is_safe_hostname "${host}" || return 1
    has_cmd dig || return 1
    out="$(dig +time="${PROBE_TIMEOUT}" +tries=1 @"${upstream}" "${host}" A +stats +answer 2> /dev/null || true)"
    rc=1
    answer_count=0
    query_ms=0
    answers=""
    if [[ -n "${out}" ]]; then
        answers="$(printf '%s\n' "${out}" | awk '$4 == "A" {print $5}' | tr '\n' ' ')"
        answer_count="$(printf '%s\n' "${answers}" | awk '{print NF}')"
        query_ms="$(printf '%s\n' "${out}" | awk -F': ' '/Query time:/ {sub(/ msec.*/, "", $2); print $2; exit}')"
        [[ "${answer_count}" =~ ^[0-9]+$ ]] || answer_count=0
        [[ "${query_ms}" =~ ^[0-9]+$ ]] || query_ms=0
        if ((answer_count > 0)); then rc=0; fi
    fi
    append_metric "upstream-benchmark" "${host}" "${upstream}" "53" "${rc}" "${answer_count}" "${query_ms}" "${answers}"
    printf '%s\t%s\t%s\t%s\n' "${upstream}" "${host}" "${rc}" "${query_ms}"
    return "${rc}"
}

ranking_last_success_epoch() {
    [[ -r "${RANKING_FILE}" ]] || {
        printf '0'
        return 0
    }
    awk -F'\t' 'NR > 1 { if ($4+0 > max) max=$4+0 } END {print max+0}' "${RANKING_FILE}" 2> /dev/null || printf '0'
}

ranking_is_fresh() {
    local now last age
    [[ -s "${RANKING_FILE}" ]] || return 1
    now="$(now_epoch)"
    last="$(ranking_last_success_epoch)"
    [[ "${last}" =~ ^[0-9]+$ && "${last}" -gt 0 ]] || return 1
    age=$((now - last))
    ((age >= 0 && age <= RANKING_MAX_AGE_SECONDS))
}

persistent_ranked_upstreams() {
    [[ -s "${RANKING_FILE}" ]] || return 0
    awk -F'\t' -v configured="${DNS_UPSTREAMS}" -v now="$(now_epoch)" -v max_age="${RANKING_MAX_AGE_SECONDS}" '
        BEGIN {
            split(configured, c, /[[:space:]]+/)
            for (i in c) if (c[i] != "") allowed[c[i]]=1
        }
        NR == 1 { next }
        $1 in allowed && $4+0 > 0 && (now-($4+0)) <= max_age {
            score=$9+0
            printf "%012d\t%s\n", score, $1
        }' "${RANKING_FILE}" 2> /dev/null | sort -n | awk -F'\t' '{print $2}'
}

benchmark_upstreams_live() {
    local upstream host raw tmp
    tmp="$(make_temp_file upstream-rank /tmp)"
    [[ -n "${tmp}" ]] || return 1
    for upstream in ${DNS_UPSTREAMS}; do
        is_valid_nameserver "${upstream}" || {
            append_report "ignored_invalid_upstream=${upstream}"
            continue
        }
        for host in ${DNS_BENCHMARK_HOSTS}; do
            is_safe_hostname "${host}" || continue
            raw="$(benchmark_one_upstream "${upstream}" "${host}")"
            [[ -n "${raw}" ]] && printf '%s\n' "${raw}" >> "${tmp}"
        done
    done
    awk -F'\t' '
        $1 != "" {
            u=$1; rc=$3+0; q=$4+0; total[u]++
            if (rc == 0) {
                ok[u]++; sum[u]+=q; vals[u, ok[u]]=q
                if (!(u in min) || q < min[u]) min[u]=q
                if (q > max[u]) max[u]=q
            } else {
                fail[u]++
            }
        }
        function sort_vals(u, n,    i,j,tmp) {
            for (i=1; i<=n; i++) for (j=i+1; j<=n; j++) if (vals[u,j] < vals[u,i]) { tmp=vals[u,i]; vals[u,i]=vals[u,j]; vals[u,j]=tmp }
        }
        END {
            for (u in total) {
                if (ok[u] > 0) {
                    sort_vals(u, ok[u])
                    pidx=int(ok[u]*0.95); if (pidx < 1) pidx=1; if (pidx > ok[u]) pidx=ok[u]
                    avg=int(sum[u]/ok[u]); p95=vals[u,pidx]
                    score=(9999-ok[u])*100000 + avg*100 + p95 + (fail[u]*10000)
                    printf "%012d\t%08d\t%08d\t%08d\t%04d\t%04d\t%s\n", score, avg, min[u], p95, ok[u], fail[u]+0, u
                }
            }
        }' "${tmp}" 2> /dev/null | sort -n
    rm -f "${tmp}" 2> /dev/null || true
}

ranking_score_for_upstream() {
    local upstream
    upstream="${1:-}"
    [[ -n "${upstream}" && -s "${RANKING_FILE}" ]] || {
        printf '999999999999'
        return 0
    }
    awk -F'\t' -v u="${upstream}" 'NR > 1 && $1 == u {print $9+0; found=1; exit} END {if (!found) print 999999999999}' "${RANKING_FILE}" 2> /dev/null || printf '999999999999'
}

save_ranking_from_live_unlocked() {
    local live_lines selected_order tmp now upstream score avg min_ms p95 ok fail selected_count selected_epoch previous_selected previous_last_selected previous_success previous_failure
    live_lines="${1:-}"
    selected_order="${2:-}"
    ensure_ranking_file_unlocked || return 0
    tmp="$(make_temp_file dns-ranking "$(dirname "${RANKING_FILE}" 2> /dev/null || printf /tmp)")"
    [[ -n "${tmp}" ]] || return 0
    now="$(now_epoch)"
    printf '%s\n' 'upstream	success_count	failure_count	last_success_epoch	last_failure_epoch	avg_ms	min_ms	p95_ms	rank_score	selected_count	last_selected_epoch' > "${tmp}" 2> /dev/null || return 0
    while IFS=$'\t' read -r score avg min_ms p95 ok fail upstream; do
        [[ -n "${upstream}" ]] || continue
        previous_selected="$(awk -F'\t' -v u="${upstream}" 'NR > 1 && $1 == u {print $10+0; exit}' "${RANKING_FILE}" 2> /dev/null || printf '0')"
        previous_last_selected="$(awk -F'\t' -v u="${upstream}" 'NR > 1 && $1 == u {print $11+0; exit}' "${RANKING_FILE}" 2> /dev/null || printf '0')"
        previous_success="$(awk -F'\t' -v u="${upstream}" 'NR > 1 && $1 == u {print $2+0; exit}' "${RANKING_FILE}" 2> /dev/null || printf '0')"
        previous_failure="$(awk -F'\t' -v u="${upstream}" 'NR > 1 && $1 == u {print $3+0; exit}' "${RANKING_FILE}" 2> /dev/null || printf '0')"
        selected_count="${previous_selected:-0}"
        selected_epoch="${previous_last_selected:-0}"
        if printf '%s\n' "${selected_order}" | awk -v u="${upstream}" 'NR == 1 && $0 == u {found=1} END {exit found ? 0 : 1}'; then
            selected_count=$((selected_count + 1))
            selected_epoch="${now}"
        fi
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "${upstream}" "$((previous_success + ok))" "$((previous_failure + fail))" "${now}" "$([[ "${fail}" -gt 0 ]] && printf '%s' "${now}" || printf '0')" \
            "${avg}" "${min_ms}" "${p95}" "${score}" "${selected_count}" "${selected_epoch}" >> "${tmp}" 2> /dev/null || true
    done <<< "${live_lines}"
    mv -f "${tmp}" "${RANKING_FILE}" 2> /dev/null || rm -f "${tmp}" 2> /dev/null || true
    chmod 0600 "${RANKING_FILE}" 2> /dev/null || true
}

save_ranking_from_live() {
    with_ranking_lock save_ranking_from_live_unlocked "$@"
}

choose_ranked_upstreams() {
    local persistent persistent_top persistent_score live_lines live_order live_top live_score last age now need_live
    persistent="$(persistent_ranked_upstreams)"
    persistent_top="$(printf '%s\n' "${persistent}" | awk 'NF{print; exit}')"
    persistent_score="$(ranking_score_for_upstream "${persistent_top}")"
    last="$(ranking_last_success_epoch)"
    now="$(now_epoch)"
    age=$((now - last))
    [[ "${age}" =~ ^-?[0-9]+$ ]] || age=999999999
    RANKING_LAST_BENCHMARK_AT="${last:-0}"
    need_live="false"

    if [[ "${RANKING_FORCE_REBENCHMARK}" == "true" || "${ACTION}" == "benchmark" ]]; then
        need_live="true"
    elif [[ -z "${persistent}" ]]; then
        need_live="true"
    elif ! ranking_is_fresh; then
        need_live="true"
    elif [[ "${RANKING_REBENCHMARK_ON_START}" == "true" && "${age}" -ge "${RANKING_REBENCHMARK_MIN_SECONDS}" ]]; then
        need_live="true"
    fi

    if [[ "${need_live}" != "true" ]]; then
        RANKING_SOURCE="persistent"
        RANKING_STALE="false"
        RANKING_REASON="fresh-within-rebenchmark-window"
        SELECTED_UPSTREAMS="$(printf '%s\n' "${persistent}" | awk 'NF{printf "%s%s", sep, $0; sep=" "}')"
        UPSTREAM_COUNT="$(printf '%s\n' "${persistent}" | awk 'NF{c++} END{print c+0}')"
        write_ranking_state
        printf '%s\n' "${persistent}"
        return 0
    fi

    live_lines="$(benchmark_upstreams_live)"
    live_order="$(printf '%s\n' "${live_lines}" | awk -F'\t' 'NF >= 7 {print $7}')"
    live_top="$(printf '%s\n' "${live_order}" | awk 'NF{print; exit}')"
    live_score="$(printf '%s\n' "${live_lines}" | awk -F'\t' 'NF >= 7 {print $1+0; exit}')"

    if [[ -z "${live_order}" ]]; then
        if [[ -n "${persistent}" ]]; then
            RANKING_SOURCE="persistent"
            RANKING_STALE="true"
            RANKING_REASON="live-benchmark-empty-using-persistent"
            SELECTED_UPSTREAMS="$(printf '%s\n' "${persistent}" | awk 'NF{printf "%s%s", sep, $0; sep=" "}')"
            UPSTREAM_COUNT="$(printf '%s\n' "${persistent}" | awk 'NF{c++} END{print c+0}')"
            write_ranking_state
            printf '%s\n' "${persistent}"
            return 0
        fi
        local static_selected
        RANKING_SOURCE="static"
        RANKING_STALE="true"
        RANKING_REASON="live-benchmark-empty-no-persistent"
        static_selected="$(valid_upstreams_static)"
        SELECTED_UPSTREAMS="$(printf '%s\n' "${static_selected}" | awk 'NF{printf "%s%s", sep, $0; sep=" "}')"
        UPSTREAM_COUNT="$(printf '%s\n' "${static_selected}" | awk 'NF{c++} END{print c+0}')"
        write_ranking_state
        printf '%s\n' "${static_selected}"
        return 0
    fi

    if [[ -n "${persistent_top}" && "${live_top}" != "${persistent_top}" && "${RANKING_FORCE_REBENCHMARK}" != "true" ]]; then
        if [[ "${live_score}" =~ ^[0-9]+$ && "${persistent_score}" =~ ^[0-9]+$ ]]; then
            if ((live_score + RANKING_HYSTERESIS_SCORE_MARGIN >= persistent_score)); then
                RANKING_SOURCE="persistent"
                RANKING_STALE="false"
                RANKING_REASON="hysteresis-kept-persistent-top"
                save_ranking_from_live "${live_lines}" "${persistent}"
                SELECTED_UPSTREAMS="$(printf '%s\n' "${persistent}" | awk 'NF{printf "%s%s", sep, $0; sep=" "}')"
                UPSTREAM_COUNT="$(printf '%s\n' "${persistent}" | awk 'NF{c++} END{print c+0}')"
                write_ranking_state
                printf '%s\n' "${persistent}"
                return 0
            fi
        fi
    fi

    RANKING_SOURCE="live-benchmark"
    RANKING_STALE="false"
    RANKING_REASON="live-benchmark-accepted"
    save_ranking_from_live "${live_lines}" "${live_order}"
    RANKING_LAST_BENCHMARK_AT="$(now_epoch)"
    SELECTED_UPSTREAMS="$(printf '%s\n' "${live_order}" | awk 'NF{printf "%s%s", sep, $0; sep=" "}')"
    UPSTREAM_COUNT="$(printf '%s\n' "${live_order}" | awk 'NF{c++} END{print c+0}')"
    write_ranking_state
    printf '%s\n' "${live_order}"
}

rank_upstreams() {
    if [[ "${DNS_UPSTREAM_SELECTION}" == "ranked" ]]; then
        if ! has_cmd dig; then
            local static_selected
            append_report "upstream_selection=ranked-fallback-no-dig"
            RANKING_SOURCE="static"
            RANKING_STALE="unknown"
            RANKING_REASON="no-dig"
            static_selected="$(valid_upstreams_static)"
            SELECTED_UPSTREAMS="$(printf '%s\n' "${static_selected}" | awk 'NF{printf "%s%s", sep, $0; sep=" "}')"
            UPSTREAM_COUNT="$(printf '%s\n' "${static_selected}" | awk 'NF{c++} END{print c+0}')"
            write_ranking_state
            printf '%s\n' "${static_selected}"
            return 0
        fi
        choose_ranked_upstreams
        return 0
    fi
    RANKING_SOURCE="static"
    RANKING_STALE="false"
    RANKING_REASON="static-selection"
    valid_upstreams_static
}

select_upstreams() {
    local selected count line
    selected=""
    count=0
    SELECTED_UPSTREAMS=""
    UPSTREAM_COUNT="0"
    selected="$(rank_upstreams)"
    if [[ -z "${selected}" ]]; then
        append_report "upstream_selection=empty-fallback-static"
        selected="$(valid_upstreams_static)"
    fi
    while IFS= read -r line; do
        [[ -n "${line}" ]] || continue
        if [[ -z "${SELECTED_UPSTREAMS}" ]]; then
            SELECTED_UPSTREAMS="${line}"
        else
            SELECTED_UPSTREAMS="${SELECTED_UPSTREAMS} ${line}"
        fi
        count=$((count + 1))
    done <<< "${selected}"
    UPSTREAM_COUNT="${count}"
    write_ranking_state
    printf '%s\n' "${selected}"
}

# -----------------------------------------------------------------------------
# dnsmasq lifecycle
# -----------------------------------------------------------------------------
write_dnsmasq_config() {
    local upstream count tmp selected_upstreams
    count=0
    mkdir -p "${RUNTIME_DIR}" 2> /dev/null || return 1
    tmp="$(make_temp_file dnsmasq.conf "${RUNTIME_DIR}")"
    [[ -n "${tmp}" ]] || return 1
    selected_upstreams="$(select_upstreams)"
    load_ranking_state
    if [[ -z "${selected_upstreams}" ]]; then
        rm -f "${tmp}" 2> /dev/null || true
        log_warn "nenhum upstream DNS válido configurado."
        return 1
    fi

    # select_upstreams is captured through command substitution, so any globals
    # set inside it would be lost in a subshell. Recompute globals here, in the
    # parent shell, so summaries always reflect the actual dnsmasq config.
    SELECTED_UPSTREAMS="$(printf '%s\n' "${selected_upstreams}" | awk 'NF{printf "%s%s", sep, $0; sep=" "}')"
    UPSTREAM_COUNT="$(printf '%s\n' "${selected_upstreams}" | awk 'NF{c++} END{print c+0}')"

    {
        printf '# Generated by %s v%s at %s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
        printf 'no-resolv\n'
        printf 'no-poll\n'
        if [[ "${READ_ETC_HOSTS}" != "true" ]]; then
            printf 'no-hosts\n'
        fi
        printf 'domain-needed\n'
        printf 'bogus-priv\n'
        if [[ "${STOP_DNS_REBIND}" == "true" ]]; then
            printf 'stop-dns-rebind\n'
        fi
        printf 'bind-interfaces\n'
        printf 'listen-address=%s\n' "${DNS_BIND_ADDRESS}"
        printf 'port=%s\n' "${DNS_BIND_PORT}"
        printf 'cache-size=%s\n' "${DNS_CACHE_SIZE}"
        if [[ "${DNS_MIN_CACHE_TTL}" -gt 0 ]]; then
            printf 'min-cache-ttl=%s\n' "${DNS_MIN_CACHE_TTL}"
        fi
        if [[ "${DNS_MAX_CACHE_TTL}" -gt 0 ]]; then
            printf 'max-cache-ttl=%s\n' "${DNS_MAX_CACHE_TTL}"
        fi
        if [[ "${DNS_NEG_TTL}" -gt 0 ]]; then
            printf 'neg-ttl=%s\n' "${DNS_NEG_TTL}"
        fi
        printf 'dns-forward-max=%s\n' "${DNS_FORWARD_MAX}"
        printf 'pid-file=%s\n' "${DNSMASQ_PID_FILE}"
        printf 'log-facility=%s\n' "${DNSMASQ_LOG_FILE}"
        printf 'log-async=25\n'
        printf 'local-service\n'
        if [[ "${DNS_ALL_SERVERS}" == "true" ]]; then
            printf 'all-servers\n'
        fi
        if [[ "${DNS_STRICT_ORDER}" == "true" ]]; then
            printf 'strict-order\n'
        fi
        if [[ "${DNS_USE_STALE_CACHE}" == "true" ]]; then
            printf 'use-stale-cache=%s\n' "${DNS_USE_STALE_CACHE_TTL}"
        fi
        if [[ "${DNS_FAST_RETRY}" == "true" ]]; then
            printf 'fast-dns-retry=%s,%s\n' "${DNS_FAST_RETRY_INITIAL_MS}" "${DNS_FAST_RETRY_WINDOW_MS}"
        fi
        if [[ "${LOG_QUERIES}" == "true" ]]; then
            printf 'log-queries=extra\n'
        fi
    } > "${tmp}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }

    while IFS= read -r upstream; do
        [[ -n "${upstream}" ]] || continue
        printf 'server=%s\n' "${upstream}" >> "${tmp}"
        count=$((count + 1))
    done <<< "${selected_upstreams}"

    if [[ "${count}" -eq 0 ]]; then
        rm -f "${tmp}" 2> /dev/null || true
        log_warn "nenhum upstream DNS válido configurado."
        return 1
    fi

    if [[ "${DNS_VALIDATE_CONFIG}" == "true" ]] && has_cmd dnsmasq; then
        local test_log
        test_log="$(make_temp_file dnsmasq-test /tmp)"
        [[ -n "${test_log}" ]] || test_log="/dev/null"
        if ! dnsmasq --test --conf-file="${tmp}" > "${test_log}" 2>&1; then
            append_report "dnsmasq_config_test=failed"
            if [[ -r "${test_log}" && "${test_log}" != "/dev/null" ]]; then
                append_report "dnsmasq_config_test_output_begin"
                sed 's/^/dnsmasq-test: /' "${test_log}" >> "${REPORT_FILE}" 2> /dev/null || true
                append_report "dnsmasq_config_test_output_end"
            fi
            rm -f "${tmp}" "${test_log}" 2> /dev/null || true
            log_warn "dnsmasq --test rejeitou a configuração gerada. Veja ${REPORT_FILE}."
            return 1
        fi
        if [[ -r "${test_log}" && "${test_log}" != "/dev/null" ]]; then
            append_report "dnsmasq_config_test=ok output=$(tr '
' ' ' < "${test_log}" 2> /dev/null || true)"
            rm -f "${test_log}" 2> /dev/null || true
        else
            append_report "dnsmasq_config_test=ok"
        fi
    fi

    mv -f "${tmp}" "${DNSMASQ_CONF}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
    chmod 0644 "${DNSMASQ_CONF}" 2> /dev/null || true
    append_report "dnsmasq_conf=${DNSMASQ_CONF} upstream_count=${count} upstreams=${SELECTED_UPSTREAMS}"
    return 0
}

probe_with_dig() {
    local kind host server port out rc answer_count query_ms answers
    kind="${1:-local}"
    host="${2:-${PROBE_HOST}}"
    server="${3:-${DNS_BIND_ADDRESS}}"
    port="${4:-${DNS_BIND_PORT}}"

    out="$(dig +time="${PROBE_TIMEOUT}" +tries=1 @"${server}" -p "${port}" "${host}" A +stats +answer 2> /dev/null || true)"
    rc=1
    answer_count=0
    query_ms=0
    answers=""

    if [[ -n "${out}" ]]; then
        answers="$(printf '%s\n' "${out}" | awk '$4 == "A" {print $5}' | tr '\n' ' ')"
        answer_count="$(printf '%s\n' "${answers}" | awk '{print NF}')"
        query_ms="$(printf '%s\n' "${out}" | awk -F': ' '/Query time:/ {sub(/ msec.*/, "", $2); print $2; exit}')"
        [[ "${answer_count}" =~ ^[0-9]+$ ]] || answer_count=0
        [[ "${query_ms}" =~ ^[0-9]+$ ]] || query_ms=0
        if ((answer_count > 0)); then
            rc=0
        fi
    fi

    append_metric "${kind}" "${host}" "${server}" "${port}" "${rc}" "${answer_count}" "${query_ms}" "${answers}"
    if [[ "${rc}" -eq 0 ]]; then
        append_report "probe=ok kind=${kind} tool=dig host=${host} server=${server} port=${port} query_ms=${query_ms} answers=${answers}"
        return 0
    fi
    append_report "probe=fail kind=${kind} tool=dig host=${host} server=${server} port=${port}"
    return 1
}

probe_local_dns() {
    if has_cmd dig; then
        if probe_with_dig "local" "${PROBE_HOST}" "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
            LOCAL_PROBE_STATUS="ok"
            return 0
        fi
        LOCAL_PROBE_STATUS="failed"
        return 1
    fi

    if has_cmd getent; then
        local out
        out="$(getent hosts "${PROBE_HOST}" 2> /dev/null || true)"
        if [[ -n "${out}" ]]; then
            append_report "probe=ok tool=getent host=${PROBE_HOST} answer=${out}"
            append_metric "local-getent" "${PROBE_HOST}" "system" "" "0" "1" "0" "${out}"
            LOCAL_PROBE_STATUS="ok-getent"
            return 0
        fi
    fi

    if dnsmasq_is_running; then
        append_report "probe=fallback-process-only rc=0"
        append_metric "fallback-process-only" "${PROBE_HOST}" "process" "" "0" "0" "0" ""
        LOCAL_PROBE_STATUS="ok-process-only"
        return 0
    fi

    append_report "probe=fallback-process-only rc=1"
    append_metric "fallback-process-only" "${PROBE_HOST}" "process" "" "1" "0" "0" ""
    LOCAL_PROBE_STATUS="failed"
    return 1
}

probe_system_resolver() {
    if has_cmd getent; then
        local out
        out="$(getent ahosts "${PROBE_HOST}" 2> /dev/null || true)"
        if [[ -n "${out}" ]]; then
            append_report "system_resolver_probe=ok host=${PROBE_HOST} answer=$(printf '%s' "${out}" | head -n 1)"
            append_metric "system-getent" "${PROBE_HOST}" "system" "" "0" "1" "0" "${out}"
            SYSTEM_PROBE_STATUS="ok"
            return 0
        fi
        append_report "system_resolver_probe=fail host=${PROBE_HOST}"
        append_metric "system-getent" "${PROBE_HOST}" "system" "" "1" "0" "0" ""
        SYSTEM_PROBE_STATUS="failed"
        return 1
    fi

    if has_cmd dig; then
        if dig +time="${PROBE_TIMEOUT}" +tries=1 "${PROBE_HOST}" A +short > /dev/null 2>&1; then
            SYSTEM_PROBE_STATUS="ok-dig"
            return 0
        fi
        SYSTEM_PROBE_STATUS="failed"
        return 1
    fi

    return 0
}

dnsmasq_real_path() {
    local path
    path="$(command -v dnsmasq 2> /dev/null || printf '')"
    [[ -n "${path}" ]] || return 1
    if has_cmd readlink; then
        readlink -f "${path}" 2> /dev/null || printf '%s\n' "${path}"
    else
        printf '%s\n' "${path}"
    fi
}

dnsmasq_has_bind_capability() {
    [[ "${PREFER_UNPRIVILEGED_DNSMASQ}" == "true" ]] || return 1
    has_cmd getcap || return 1
    local bin caps
    bin="$(dnsmasq_real_path)"
    [[ -n "${bin}" && -e "${bin}" ]] || return 1
    caps="$(getcap "${bin}" 2> /dev/null || true)"
    [[ "${caps}" == *cap_net_bind_service* ]]
}

process_is_dnsmasq() {
    local pid comm cmdline
    pid="${1:-}"
    [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
    [[ -d "/proc/${pid}" ]] || return 1
    comm="$(cat "/proc/${pid}/comm" 2> /dev/null || true)"
    [[ "${comm}" == "dnsmasq" ]] && return 0
    [[ -r "/proc/${pid}/cmdline" ]] || return 1
    cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2> /dev/null || true)"
    [[ "${cmdline}" == *"dnsmasq"* ]]
}

wait_for_pid_exit() {
    local pid deadline now
    pid="${1:-}"
    [[ "${pid}" =~ ^[0-9]+$ ]] || return 0
    now="$(date +%s%3N 2> /dev/null || date +%s000 2> /dev/null || printf '0')"
    deadline=$((now + DNSMASQ_STOP_WAIT_MS))
    while pid_is_alive "${pid}"; do
        now="$(date +%s%3N 2> /dev/null || date +%s000 2> /dev/null || printf '0')"
        ((now >= deadline)) && return 1
        sleep 0.1
    done
    return 0
}

terminate_dnsmasq_pid() {
    local pid reason term_rc kill_rc
    pid="${1:-}"
    reason="${2:-unknown}"
    process_is_dnsmasq "${pid}" || return 1
    append_report "dnsmasq_stop_pid=${pid} reason=${reason}"

    term_rc=1
    safe_sudo kill -TERM "${pid}" 2> /dev/null
    term_rc=$?
    if [[ "${term_rc}" -ne 0 ]]; then
        kill -TERM "${pid}" 2> /dev/null
        term_rc=$?
    fi
    append_report "dnsmasq_stop_term_rc=${term_rc} pid=${pid} reason=${reason}"

    if wait_for_pid_exit "${pid}"; then
        append_report "dnsmasq_stop_result=terminated pid=${pid} reason=${reason}"
        return 0
    fi

    append_report "dnsmasq_stop_escalate=${pid} reason=${reason}"
    kill_rc=1
    safe_sudo kill -KILL "${pid}" 2> /dev/null
    kill_rc=$?
    if [[ "${kill_rc}" -ne 0 ]]; then
        kill -KILL "${pid}" 2> /dev/null
        kill_rc=$?
    fi
    append_report "dnsmasq_stop_kill_rc=${kill_rc} pid=${pid} reason=${reason}"

    if wait_for_pid_exit "${pid}"; then
        append_report "dnsmasq_stop_result=killed pid=${pid} reason=${reason}"
        return 0
    fi

    append_report "dnsmasq_stop_result=still-alive pid=${pid} reason=${reason}"
    return 1
}

stop_stale_dnsmasq_from_pidfile() {
    local pid
    [[ "${TAKEOVER_STALE_DNSMASQ}" == "true" ]] || return 1
    pid="$(read_dnsmasq_pid)"
    [[ -n "${pid}" ]] || return 1
    process_is_dnsmasq "${pid}" || return 1
    log_warn "pid file aponta para dnsmasq não reconhecido como saudável (${pid}); assumindo ownership por ser pid-file do runtime."
    terminate_dnsmasq_pid "${pid}" "stale-pidfile"
    return $?
}

socket_dnsmasq_pids() {
    [[ "${STOP_BY_SOCKET_OWNER}" == "true" ]] || return 0
    has_cmd ss || return 0
    ss -H -lntup 2> /dev/null \
        | awk -v bind="${DNS_BIND_ADDRESS}:${DNS_BIND_PORT}" -v port=":${DNS_BIND_PORT}" '
            $0 ~ port {
                while (match($0, /pid=[0-9]+/)) {
                    pid=substr($0, RSTART+4, RLENGTH-4)
                    print pid
                    $0=substr($0, RSTART+RLENGTH)
                }
            }
        ' \
        | awk 'NF && !seen[$0]++'
}

stop_dnsmasq_on_socket() {
    local pid stopped
    stopped=1
    while IFS= read -r pid; do
        [[ -n "${pid}" ]] || continue
        if process_is_dnsmasq "${pid}"; then
            log_warn "porta DNS ocupada por dnsmasq pid=${pid}; tentando encerramento controlado."
            terminate_dnsmasq_pid "${pid}" "socket-owner" && stopped=0
        fi
    done < <(socket_dnsmasq_pids)
    return "${stopped}"
}

prepare_dnsmasq_runtime_for_start() {
    mkdir -p "${RUNTIME_DIR}" 2> /dev/null || return 1

    # Stale pid/log files may be root-owned from a previous privileged dnsmasq.
    # Remove them with sudo best-effort before starting a new controlled instance.
    if [[ -e "${DNSMASQ_PID_FILE}" ]]; then
        remove_file_privileged "${DNSMASQ_PID_FILE}" || true
    fi

    if [[ -e "${DNSMASQ_LOG_FILE}" && ! -w "${DNSMASQ_LOG_FILE}" ]]; then
        remove_file_privileged "${DNSMASQ_LOG_FILE}" || true
    fi

    truncate_file_privileged "${DNSMASQ_LOG_FILE}" || true
    chmod 0644 "${DNSMASQ_LOG_FILE}" 2> /dev/null || safe_sudo chmod 0644 "${DNSMASQ_LOG_FILE}" 2> /dev/null || true
    return 0
}

start_dnsmasq_process_as_user() {
    dnsmasq --conf-file="${DNSMASQ_CONF}" > /dev/null 2> /dev/null
}

start_dnsmasq_process_as_root() {
    safe_sudo dnsmasq --conf-file="${DNSMASQ_CONF}" > /dev/null 2> /dev/null
}

start_dnsmasq_process() {
    local rc mode
    mode="${DNSMASQ_START_MODE}"
    prepare_dnsmasq_runtime_for_start || true

    if [[ "$(id -u 2> /dev/null || echo 1)" == "0" ]]; then
        append_report "dnsmasq_start_mode=direct-root"
        start_dnsmasq_process_as_user
        return $?
    fi

    case "${mode}" in
        user)
            append_report "dnsmasq_start_mode=user-forced"
            start_dnsmasq_process_as_user
            return $?
            ;;
        root)
            append_report "dnsmasq_start_mode=root-forced"
            start_dnsmasq_process_as_root
            return $?
            ;;
        auto)
            if [[ "${DNS_BIND_PORT}" -lt 1024 ]]; then
                if [[ "${PREFER_UNPRIVILEGED_DNSMASQ}" == "true" ]]; then
                    if dnsmasq_has_bind_capability; then
                        append_report "dnsmasq_start_mode=auto-user-capability-for-privileged-port"
                        start_dnsmasq_process_as_user
                        rc=$?
                        if [[ "${rc}" -eq 0 ]]; then
                            return 0
                        fi
                        append_report "dnsmasq_start_user_capability_failed_rc=${rc}; trying root"
                    else
                        append_report "dnsmasq_start_user_capability_unavailable; using root"
                    fi
                fi
                append_report "dnsmasq_start_mode=auto-root-for-privileged-port"
                start_dnsmasq_process_as_root
                return $?
            fi
            append_report "dnsmasq_start_mode=auto-user-unprivileged-port"
            start_dnsmasq_process_as_user
            return $?
            ;;
    esac

    start_dnsmasq_process_as_user
}

diagnose_dnsmasq_failure() {
    append_report "dnsmasq_diagnostics=begin"
    if [[ -r "${DNSMASQ_CONF}" ]]; then
        append_report "dnsmasq_conf_begin"
        sed 's/^/conf: /' "${DNSMASQ_CONF}" >> "${REPORT_FILE}" 2> /dev/null || true
        append_report "dnsmasq_conf_end"
    fi
    if [[ -r "${DNSMASQ_LOG_FILE}" ]]; then
        append_report "dnsmasq_log_tail_begin"
        tail -n 80 "${DNSMASQ_LOG_FILE}" 2> /dev/null | sed 's/^/log: /' >> "${REPORT_FILE}" 2> /dev/null || true
        append_report "dnsmasq_log_tail_end"
    fi
    if has_cmd ss; then
        append_report "dnsmasq_socket_snapshot_begin"
        ss -H -lntup 2> /dev/null | awk -v p=":${DNS_BIND_PORT}" '$0 ~ p {print "ss: "$0}' >> "${REPORT_FILE}" 2> /dev/null || true
        append_report "dnsmasq_socket_snapshot_end"
    fi
    append_report "dnsmasq_diagnostics=end"
}

repair_after_local_probe_failure() {
    [[ "${REPAIR_ON_PROBE_FAILURE}" == "true" ]] || return 1
    append_report "repair=attempt reason=local-probe-failed"
    diagnose_dnsmasq_failure
    stop_dnsmasq || true
    write_dnsmasq_config || {
        append_report "repair=failed stage=config"
        return 1
    }
    rm -f "${DNSMASQ_PID_FILE}" 2> /dev/null || true
    start_dnsmasq_process
    sleep 0.5
    if dnsmasq_is_running && probe_local_dns; then
        append_report "repair=ok"
        return 0
    fi
    append_report "repair=failed stage=probe"
    diagnose_dnsmasq_failure
    return 1
}

start_dnsmasq() {
    if [[ "${DNS_MODE}" == "off" ]]; then
        log_info "DNS cache local desligado por DEVCONTAINER_LOCAL_DNS_CACHE_MODE=off."
        write_status "off"
        append_report "result=off"
        write_summary "off" "mode-off"
        return 0
    fi

    if ! is_valid_bind_address "${DNS_BIND_ADDRESS}"; then
        log_warn "bind_address não permitido: ${DNS_BIND_ADDRESS}. Use loopback ou DEVCONTAINER_LOCAL_DNS_ALLOW_NON_LOOPBACK_BIND=true."
        append_report "result=unsafe-bind-address bind_address=${DNS_BIND_ADDRESS}"
        write_status "degraded"
        write_summary "degraded" "unsafe-bind-address"
        return 1
    fi

    if [[ "${WRITE_RESOLV_CONF}" == "true" && "${DNS_BIND_PORT}" != "53" ]]; then
        log_warn "resolv.conf não suporta porta customizada; WRITE_RESOLV_CONF=true exige DNS_BIND_PORT=53."
        append_report "result=invalid-resolv-port bind_port=${DNS_BIND_PORT}"
        write_status "degraded"
        write_summary "degraded" "invalid-resolv-port"
        return 1
    fi

    if ! has_cmd dnsmasq; then
        log_warn "dnsmasq não encontrado no PATH. Instale dnsmasq no Dockerfile para usar DNS cache local."
        append_report "result=no-dnsmasq"
        if [[ "${DNS_MODE}" == "auto" ]]; then
            write_status "off"
            write_summary "off" "no-dnsmasq-auto"
            return 0
        fi
        write_status "degraded"
        write_summary "degraded" "no-dnsmasq"
        return 1
    fi

    if dnsmasq_is_running; then
        log_info "dnsmasq já está em execução para ${DNSMASQ_CONF}; validando antes de reutilizar."
        if [[ -r "${DNSMASQ_CONF}" ]]; then
            SELECTED_UPSTREAMS="$(awk -F= '$1=="server" {printf "%s%s", sep, $2; sep=" "}' "${DNSMASQ_CONF}" 2> /dev/null || true)"
            UPSTREAM_COUNT="$(awk -F= '$1=="server" {c++} END{print c+0}' "${DNSMASQ_CONF}" 2> /dev/null || printf '0')"
        fi
        if probe_local_dns; then
            append_report "dnsmasq=reused-running probe=ok"
            return 0
        fi
        append_report "dnsmasq=reused-running probe=failed; attempting-restart"
        stop_dnsmasq || true
    fi

    if [[ "${STRICT_PORT_CHECK}" == "true" ]] && port_in_use "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
        stop_stale_dnsmasq_from_pidfile || true
        if port_in_use "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
            stop_dnsmasq_on_socket || true
        fi
    fi

    if [[ "${STRICT_PORT_CHECK}" == "true" ]] && port_in_use "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
        log_warn "porta DNS ${DNS_BIND_ADDRESS}:${DNS_BIND_PORT} já parece estar em uso por outro processo, ou por dnsmasq legado que não pôde ser encerrado."
        append_report "result=port-in-use bind=${DNS_BIND_ADDRESS}:${DNS_BIND_PORT}"
        diagnose_dnsmasq_failure
        write_status "degraded"
        write_summary "degraded" "port-in-use"
        return 1
    fi

    write_dnsmasq_config || {
        log_warn "falha ao gerar configuração dnsmasq."
        write_status "degraded"
        write_summary "degraded" "dnsmasq-config-failed"
        return 1
    }

    remove_file_privileged "${DNSMASQ_PID_FILE}" || true

    start_dnsmasq_process
    local start_rc
    start_rc=$?
    append_report "dnsmasq_start_rc=${start_rc}"

    sleep 0.5
    if dnsmasq_is_running; then
        log_ok "dnsmasq ativo em ${DNS_BIND_ADDRESS}:${DNS_BIND_PORT}."
        append_report "dnsmasq=running"
        return 0
    fi

    log_warn "dnsmasq não ficou ativo. Veja ${DNSMASQ_LOG_FILE}."
    append_report "dnsmasq=not-running log=${DNSMASQ_LOG_FILE}"
    diagnose_dnsmasq_failure
    write_status "degraded"
    write_summary "degraded" "dnsmasq-not-running"
    return 1
}

restore_or_fallback_resolv_conf() {
    [[ "${WRITE_RESOLV_CONF}" == "true" ]] || return 0
    [[ "${RESTORE_RESOLV_CONF_ON_STOP}" == "true" ]] || return 0

    if [[ -s "${RESOLV_BACKUP_FILE}" ]]; then
        if safe_sudo tee /etc/resolv.conf < "${RESOLV_BACKUP_FILE}" > /dev/null 2>&1; then
            log_info "/etc/resolv.conf restaurado a partir de ${RESOLV_BACKUP_FILE}."
            append_report "resolv_conf=restored backup=${RESOLV_BACKUP_FILE}"
            RESOLV_CONF_STATUS="restored"
            return 0
        fi
    fi

    local tmp upstream count
    tmp="$(make_temp_file resolv-stop-fallback /tmp)"
    [[ -n "${tmp}" ]] || return 1
    count=0
    {
        printf '# Generated fallback by %s v%s at %s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
        for upstream in ${DNS_UPSTREAMS}; do
            if is_valid_nameserver "${upstream}"; then
                printf 'nameserver %s\n' "${upstream}"
                count=$((count + 1))
                [[ "${count}" -ge 3 ]] && break
            fi
        done
        printf 'options %s\n' "${DNS_OPTIONS}"
    } > "${tmp}" 2> /dev/null || true

    if [[ "${count}" -gt 0 ]] && safe_sudo tee /etc/resolv.conf < "${tmp}" > /dev/null 2>&1; then
        rm -f "${tmp}" 2> /dev/null || true
        log_info "/etc/resolv.conf restaurado para fallback upstream."
        append_report "resolv_conf=fallback-restored"
        RESOLV_CONF_STATUS="fallback-restored"
        return 0
    fi

    rm -f "${tmp}" 2> /dev/null || true
    log_warn "não foi possível restaurar /etc/resolv.conf."
    append_report "resolv_conf=restore-failed"
    RESOLV_CONF_STATUS="restore-failed"
    return 1
}

stop_dnsmasq() {
    local pid stop_rc
    stop_rc=0
    pid="$(read_dnsmasq_pid)"
    if managed_dnsmasq_pid_is_alive; then
        terminate_dnsmasq_pid "${pid}" "managed" || stop_rc=1
    elif [[ -n "${pid}" ]]; then
        if ! stop_stale_dnsmasq_from_pidfile; then
            log_warn "pid file existe, mas PID não parece ser dnsmasq gerenciado ou não pôde ser encerrado: ${pid}."
            stop_rc=1
        fi
    fi

    if port_in_use "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
        stop_dnsmasq_on_socket || stop_rc=1
    fi

    if port_in_use "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
        append_report "dnsmasq_stop_result=port-still-in-use bind=${DNS_BIND_ADDRESS}:${DNS_BIND_PORT}"
        diagnose_dnsmasq_failure
    else
        rm -f "${DNSMASQ_PID_FILE}" 2> /dev/null || true
    fi

    restore_or_fallback_resolv_conf || true
    log_info "dnsmasq stop solicitado."
    return "${stop_rc}"
}

resolv_conf_is_managed() {
    grep -q "${RESOLV_MANAGED_MARKER}" /etc/resolv.conf 2> /dev/null
}

backup_resolv_conf_once() {
    [[ -r /etc/resolv.conf ]] || return 0

    if resolv_conf_is_managed; then
        append_report "resolv_conf_backup=preserved existing=${RESOLV_BACKUP_FILE} reason=current-managed"
        return 0
    fi

    if [[ -s "${RESOLV_BACKUP_FILE}" ]] && ! grep -q "${RESOLV_MANAGED_MARKER}" "${RESOLV_BACKUP_FILE}" 2> /dev/null; then
        append_report "resolv_conf_backup=preserved existing=${RESOLV_BACKUP_FILE}"
        return 0
    fi

    cp /etc/resolv.conf "${RESOLV_BACKUP_FILE}" 2> /dev/null || return 0
    chmod 0600 "${RESOLV_BACKUP_FILE}" 2> /dev/null || true
    append_report "resolv_conf_backup=${RESOLV_BACKUP_FILE}"
    return 0
}

verify_resolv_conf_points_to_cache() {
    awk -v ns="${DNS_BIND_ADDRESS}" '
        $1 == "nameserver" && $2 == ns { found=1 }
        END { exit found ? 0 : 1 }
    ' /etc/resolv.conf 2> /dev/null
}

write_resolv_conf() {
    local tmp
    [[ "${WRITE_RESOLV_CONF}" == "true" ]] || {
        log_info "rewrite de /etc/resolv.conf desabilitado."
        RESOLV_CONF_STATUS="disabled"
        return 0
    }

    if [[ "${DNS_BIND_PORT}" != "53" ]]; then
        log_warn "não escrevendo /etc/resolv.conf: porta DNS não é 53 (${DNS_BIND_PORT})."
        RESOLV_CONF_STATUS="invalid-port"
        return 1
    fi

    backup_resolv_conf_once || true

    tmp="$(make_temp_file resolv.conf /tmp)"
    [[ -n "${tmp}" ]] || return 1
    {
        printf '# %s by %s v%s at %s\n' "${RESOLV_MANAGED_MARKER}" "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
        printf 'nameserver %s\n' "${DNS_BIND_ADDRESS}"
        printf 'options %s\n' "${DNS_OPTIONS}"
    } > "${tmp}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }

    if ! safe_sudo tee /etc/resolv.conf < "${tmp}" > /dev/null 2>&1; then
        rm -f "${tmp}" 2> /dev/null || true
        log_warn "falha ao escrever /etc/resolv.conf via tee."
        RESOLV_CONF_STATUS="write-failed"
        return 1
    fi

    rm -f "${tmp}" 2> /dev/null || true

    if ! verify_resolv_conf_points_to_cache; then
        log_warn "/etc/resolv.conf foi escrito, mas não aponta para ${DNS_BIND_ADDRESS}."
        append_report "resolv_conf=verify-failed expected_nameserver=${DNS_BIND_ADDRESS}"
        RESOLV_CONF_STATUS="verify-failed"
        return 1
    fi

    append_report "resolv_conf=updated nameserver=${DNS_BIND_ADDRESS} options=${DNS_OPTIONS}"
    RESOLV_CONF_STATUS="updated"
    log_ok "/etc/resolv.conf aponta para cache DNS local (${DNS_BIND_ADDRESS})."
    return 0
}

status_dnsmasq() {
    collect_runtime_health
    if [[ "${DNS_MODE}" == "off" ]]; then
        log_info "DNS cache mode off."
        write_status "off"
        write_summary "off" "mode-off"
        return 0
    fi
    if [[ "${STATUS_STALE}" == "true" ]]; then
        log_warn "status stale: ${STATUS_STALE_REASON}."
        write_status "stale"
        write_summary "stale" "${STATUS_STALE_REASON}"
        return 1
    fi
    if [[ "${DNSMASQ_PROCESS_STATUS}" == running-* ]]; then
        log_ok "dnsmasq running; process_status=${DNSMASQ_PROCESS_STATUS}; resolv_conf=${RESOLV_CONF_HEALTH}; conf=${DNSMASQ_CONF}; pid_file=${DNSMASQ_PID_FILE}"
        write_status "ok"
        write_summary "ok" "dnsmasq-running"
        return 0
    fi
    log_warn "dnsmasq não está rodando. process_status=${DNSMASQ_PROCESS_STATUS}; resolv_conf=${RESOLV_CONF_HEALTH}"
    write_status "stopped"
    write_summary "stopped" "dnsmasq-not-running"
    return 1
}
benchmark_action() {
    local selected
    write_metrics_header
    selected="$(choose_ranked_upstreams)"
    load_ranking_state
    if [[ -z "${selected}" ]]; then
        log_warn "benchmark não encontrou upstream funcional."
        SELECTED_UPSTREAMS=""
        UPSTREAM_COUNT="0"
        write_summary "degraded" "benchmark-no-functional-upstream"
        return 1
    fi
    SELECTED_UPSTREAMS="$(printf '%s' "${selected}" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
    UPSTREAM_COUNT="$(printf '%s\n' "${selected}" | awk 'NF{c++} END{print c+0}')"
    append_report "benchmark_ranked_upstreams=${SELECTED_UPSTREAMS} source=${RANKING_SOURCE} reason=${RANKING_REASON}"
    log_ok "benchmark upstreams: ${SELECTED_UPSTREAMS}"
    write_summary "ok" "benchmark-ok"
    return 0
}
doctor_action() {
    local rc
    rc=0
    log_info "doctor: validando dependências e contrato DNS."
    for cmd in dnsmasq awk date mktemp; do
        if has_cmd "${cmd}"; then
            log_ok "doctor: ${cmd} disponível."
        else
            log_warn "doctor: ${cmd} indisponível."
            [[ "${cmd}" == "dnsmasq" ]] && rc=1
        fi
    done
    if has_cmd dig; then log_ok "doctor: dig disponível."; else log_warn "doctor: dig ausente; probes DNS serão reduzidos."; fi
    if has_cmd ss; then log_ok "doctor: ss disponível."; else log_warn "doctor: ss ausente; port check será limitado."; fi
    if has_cmd flock; then log_ok "doctor: flock disponível."; else log_warn "doctor: flock ausente; lock será best-effort."; fi
    if [[ "${WRITE_RESOLV_CONF}" == "true" && "${DNS_BIND_PORT}" != "53" ]]; then
        log_warn "doctor: WRITE_RESOLV_CONF=true exige DNS_BIND_PORT=53."
        rc=1
    fi
    if ! is_valid_bind_address "${DNS_BIND_ADDRESS}"; then
        log_warn "doctor: bind address inseguro/não permitido: ${DNS_BIND_ADDRESS}"
        rc=1
    fi
    if [[ "${STRICT_PORT_CHECK}" == "true" ]] && port_in_use "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}" && ! dnsmasq_is_running; then
        log_warn "doctor: porta ${DNS_BIND_ADDRESS}:${DNS_BIND_PORT} já está em uso por processo não gerenciado."
        rc=1
    fi
    if ! is_valid_nameserver "$(printf '%s' "${DNS_UPSTREAMS}" | awk '{print $1}')"; then
        log_warn "doctor: primeiro upstream DNS parece inválido; verifique DEVCONTAINER_LOCAL_DNS_UPSTREAMS."
    fi
    collect_runtime_health
    log_info "doctor: dnsmasq_process_status=${DNSMASQ_PROCESS_STATUS}; dnsmasq_port_status=${DNSMASQ_PORT_STATUS}; resolv_conf_health=${RESOLV_CONF_HEALTH}; status_stale=${STATUS_STALE}."
    if [[ "${DNS_UPSTREAM_SELECTION}" == "ranked" ]]; then
        if [[ -s "${RANKING_FILE}" ]]; then
            log_ok "doctor: ranking persistente detectado: ${RANKING_FILE}"
        else
            log_warn "doctor: ranking persistente ainda ausente; será criado no próximo benchmark/start ranked."
        fi
    fi
    if [[ "${rc}" -eq 0 ]]; then
        write_summary "ok" "doctor"
    else
        write_summary "degraded" "doctor"
    fi
    return "${rc}"
}

health_action() {
    local rc
    rc=0
    collect_runtime_health
    if [[ "${DNSMASQ_PROCESS_STATUS}" != running-* ]]; then
        rc=1
    fi
    if [[ "${WRITE_RESOLV_CONF}" == "true" && "${RESOLV_CONF_HEALTH}" != *"points-to-cache"* ]]; then
        rc=1
    fi
    if [[ "${rc}" -eq 0 ]]; then
        probe_local_dns || rc=1
        probe_system_resolver || rc=1
    fi
    if [[ "${rc}" -eq 0 ]]; then
        write_status "ok"
        write_summary "ok" "health-ok"
        log_ok "health OK: dnsmasq=${DNSMASQ_PROCESS_STATUS}; resolv_conf=${RESOLV_CONF_HEALTH}; local_probe=${LOCAL_PROBE_STATUS}; system_probe=${SYSTEM_PROBE_STATUS}"
    else
        write_status "degraded"
        write_summary "degraded" "health-degraded"
        log_warn "health degraded: dnsmasq=${DNSMASQ_PROCESS_STATUS}; resolv_conf=${RESOLV_CONF_HEALTH}; local_probe=${LOCAL_PROBE_STATUS}; system_probe=${SYSTEM_PROBE_STATUS}"
    fi
    return "${rc}"
}

start_flow() {
    local current_status
    start_dnsmasq || return 1
    current_status="$(cat "${STATUS_FILE}" 2> /dev/null || printf '')"
    if [[ "${DNS_MODE}" == "off" || "${current_status}" == "off" ]]; then return 0; fi

    if ! probe_local_dns; then
        if repair_after_local_probe_failure; then
            append_report "probe_local_after_repair=ok"
        else
            if resolv_conf_is_managed; then
                append_report "resolv_conf=managed-but-local-probe-failed; restoring fallback"
                restore_or_fallback_resolv_conf || true
            fi
            write_status "degraded"
            append_report "result=probe-local-failed"
            write_summary "degraded" "probe-local-failed"
            return 1
        fi
    fi

    write_resolv_conf || {
        write_status "degraded"
        append_report "result=resolv-conf-failed"
        write_summary "degraded" "resolv-conf-failed"
        return 1
    }

    probe_system_resolver || {
        write_status "degraded"
        append_report "result=system-resolver-probe-failed"
        write_summary "degraded" "system-resolver-probe-failed"
        return 1
    }

    write_status "ok"
    append_report "result=ok"
    write_summary "ok" "start-flow-ok"
    log_ok "Local DNS cache aplicado e validado."
    return 0
}

main_unlocked() {
    local probe_rc
    write_report_header
    write_metrics_header
    write_status "running"
    log_info "Local DNS cache manager iniciado (v${SCRIPT_VERSION}); action=${ACTION}; mode=${DNS_MODE}."
    log_debug "PATH=${PATH:-<unset>}"
    log_debug "DNS_BIND_ADDRESS=${DNS_BIND_ADDRESS}; DNS_BIND_PORT=${DNS_BIND_PORT}; WRITE_RESOLV_CONF=${WRITE_RESOLV_CONF}"
    log_debug "DNS_UPSTREAMS=${DNS_UPSTREAMS}"

    if ! is_safe_hostname "${PROBE_HOST}"; then
        log_warn "probe_host inválido/não seguro: ${PROBE_HOST}"
        write_status "degraded"
        append_report "result=invalid-probe-host host=${PROBE_HOST}"
        write_summary "degraded" "invalid-probe-host"
        return 1
    fi

    case "${ACTION}" in
        stop)
            stop_dnsmasq
            write_status "stopped"
            append_report "result=stopped"
            return 0
            ;;
        status)
            status_dnsmasq
            return $?
            ;;
        benchmark)
            benchmark_action
            return $?
            ;;
        doctor)
            doctor_action
            return $?
            ;;
        health)
            health_action
            return $?
            ;;
        restart)
            stop_dnsmasq || true
            ;;
        probe)
            probe_local_dns
            probe_rc=$?
            if [[ "${probe_rc}" -eq 0 ]]; then
                write_summary "ok" "probe"
            else
                write_summary "degraded" "probe"
            fi
            return "${probe_rc}"
            ;;
    esac

    start_flow
    return $?
}

main() {
    mkdir -p "${RUNTIME_DIR}" 2> /dev/null || true
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
