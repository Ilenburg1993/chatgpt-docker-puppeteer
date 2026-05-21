#!/usr/bin/env bash
# =============================================================================
# local-dns-cache.sh — DevContainer Local DNS Cache Manager
# Version: v1.8.0
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
#
# v1.5.3 focus:
#   - Fixes the undefined read_first_line regression seen during start.
#   - Makes benchmark summaries non-stale when dnsmasq is intentionally not
#     running, separating benchmark-only state from runtime-active state.
#   - Strengthens runtime health detection when a stale pidfile exists but a
#     managed dnsmasq process is actually alive.
#   - Fails closed before writing /etc/resolv.conf unless the local dnsmasq
#     process and local DNS probe are both proven healthy.
#   - Restores /etc/resolv.conf automatically after post-write resolver probe
#     failures, preventing 127.0.0.1 from being left behind without a working
#     cache.
#   - Adds process/port diagnostics and stop handling for managed dnsmasq
#     processes discovered by command line even when the pidfile is stale.
#
# v1.6.0 focus:
#   - Separates previous-summary staleness from current runtime health, fixing
#     self-contamination where a fresh summary could inherit
#     summary-from-different-container-init from an older /tmp artifact.
#   - Adds explicit runtime proof fields: runtime_effective,
#     resolver_effective, resolv_conf_points_to_cache,
#     system_resolver_uses_cache, socket PID ownership and managed-port status.
#   - Improves stale-pidfile semantics: a dnsmasq discovered by current config
#     command line is treated as managed even when the pidfile is stale/missing.
#   - Makes status/health decisions depend on current process + port + resolver
#     proof, not merely the first line of an old status file.
#   - Keeps the same mutation scope: only managed dnsmasq lifecycle and optional
#     /etc/resolv.conf content rewrite via tee; no Docker/DevContainer changes.
#
# v1.6.1 focus:
#   - Adds /etc/resolv.conf drift forensics: inode, mtime, checksum, first
#     nameserver, summary age and explicit drift reason.
#   - Repairs the misleading socket-owner state where a bound port with hidden
#     or unreported PIDs was summarized as "none".
#   - Best-effort repairs managed stale pidfiles when the current dnsmasq
#     process is found by command line and the pidfile points elsewhere.
#   - Reclassifies status/health as stale when a previous OK summary claimed
#     cache ownership but current /etc/resolv.conf has drifted.
#   - Keeps benchmark-only state separate from runtime resolver effectiveness.
#
# v1.7.0 focus:
#   - Adds explicit action artifacts so benchmark/doctor diagnostics no longer
#     overwrite the runtime resolver summary by default.
#   - Preserves Docker embedded DNS awareness: detects 127.0.0.11, can include
#     it as a controlled upstream, and reports that choice explicitly.
#   - Preserves safe search/domain directives when rewriting /etc/resolv.conf,
#     avoiding accidental loss of Docker/Compose search behavior.
#   - Adds backup metadata for /etc/resolv.conf and refuses stale backup restore
#     across container-init boundaries unless explicitly allowed.
#   - Adds bounded DNS warmup for GitHub/Copilot hosts after a proven start, to
#     prime the local cache without adding long benchmarks to boot.
#   - Gates optional dnsmasq features through --test probes when possible,
#     avoiding hard failure on older distro dnsmasq builds.
#
# v1.8.0 focus:
#   - Hardens DNS for default-on operation: no /etc/resolv.conf rewrite unless
#     the local cache is proven through a real DNS client probe, not merely by
#     process presence.
#   - Adds split-horizon Docker embedded DNS routing by default when 127.0.0.11
#     is detected, preserving Docker/Compose service discovery without sending
#     all public GitHub/Copilot DNS traffic through Docker's embedded resolver.
#   - Avoids boot-time live upstream benchmarks by default even when ranked
#     selection is configured; ranking is persistent/manual unless explicitly
#     re-enabled for start.
#   - Fixes target-port detection so a listener on 127.0.0.11:53 or another
#     loopback address is not mistaken for a conflict on 127.0.0.1:53.
#   - Adds richer proof/summary fields for default-on governance: local probe
#     tool/proof, Docker split domains, resolv.conf write privilege, and target
#     port conflict status.
# =============================================================================

set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

# -----------------------------------------------------------------------------
# CLI read-only helpers
# -----------------------------------------------------------------------------
case "${1:-}" in
    --version)
        printf '%s v%s\n' 'local-dns-cache.sh' '1.8.0'
        exit 0
        ;;
    --help)
        cat << 'USAGE'
local-dns-cache.sh [--help] [--version] [action]

Environment-driven actions:
  DEVCONTAINER_LOCAL_DNS_ACTION=start|status|stop|restart|probe|benchmark|doctor|health
  DEVCONTAINER_LOCAL_DNS_CACHE_ACTION is kept as a compatibility alias.

Positional action alias:
  bash local-dns-cache.sh status
  bash local-dns-cache.sh health
  bash local-dns-cache.sh benchmark

Key knobs:
  DEVCONTAINER_LOCAL_DNS_MODE=off|auto|local|required
  DEVCONTAINER_LOCAL_DNS_WRITE_RESOLV_CONF=true|false
  DEVCONTAINER_LOCAL_DNS_UPSTREAM_SELECTION=static|ranked

Runtime proof fields emitted in the summary include runtime_effective,
resolver_effective, resolv_conf_points_to_cache, system_resolver_uses_cache,
previous_summary_stale, resolv_conf_drift and resolv_conf identity fields.

v1.7.0+ emits action.summary and events TSV artifacts, preserves safe
search/domain directives when rewriting /etc/resolv.conf, tracks Docker embedded
DNS 127.0.0.11, and can warm GitHub/Copilot DNS names after a proven start.

v1.8.0 makes default-on operation stricter: /etc/resolv.conf is not rewritten
unless the local cache is proven by dig/drill/nslookup, Docker embedded DNS is
split-routed by default when detected, and ranked mode avoids live boot
benchmarks unless explicitly enabled.

This script is runtime-only. It may start a bounded loopback dnsmasq helper and
may rewrite /etc/resolv.conf when explicitly enabled by configuration.
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

is_nonnegative_int() {
    [[ "${1:-}" =~ ^[0-9]+$ ]]
}

uint_or_zero() {
    local value
    value="${1:-0}"
    if is_nonnegative_int "${value}"; then
        printf '%s' "${value}"
    else
        printf '0'
    fi
}

sanitize_resolv_options() {
    # /etc/resolv.conf options are whitespace-separated tokens. Keep only a
    # conservative subset to prevent env-driven newline/config injection while
    # preserving the intended performance knobs: timeout, attempts, ndots and
    # rotate. Numeric values are bounded to glibc-safe operational ranges.
    local raw token output key value
    raw="${1:-}"
    output=""

    for token in ${raw}; do
        key=""
        value=""
        case "${token}" in
            timeout:[0-9]*)
                key="timeout"
                value="${token#timeout:}"
                value="$(cfg_uint "${value}" 1 1 30)"
                token="${key}:${value}"
                ;;
            attempts:[0-9]*)
                key="attempts"
                value="${token#attempts:}"
                value="$(cfg_uint "${value}" 2 1 5)"
                token="${key}:${value}"
                ;;
            ndots:[0-9]*)
                key="ndots"
                value="${token#ndots:}"
                value="$(cfg_uint "${value}" 1 0 15)"
                token="${key}:${value}"
                ;;
            rotate | edns0 | trust-ad | single-request | single-request-reopen) ;;
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
SCRIPT_VERSION="1.8.0"
readonly SCRIPT_VERSION

POSITIONAL_ACTION=""
case "${1:-}" in
    start | status | stop | restart | probe | benchmark | doctor | health)
        POSITIONAL_ACTION="${1}"
        ;;
esac
readonly POSITIONAL_ACTION

ACTION="${DEVCONTAINER_LOCAL_DNS_ACTION:-${DEVCONTAINER_LOCAL_DNS_CACHE_ACTION:-${POSITIONAL_ACTION:-start}}}"
case "${ACTION}" in
    start | status | stop | restart | probe | benchmark | doctor | health) : ;;
    *) ACTION="start" ;;
esac
readonly ACTION

DNS_MODE="${DEVCONTAINER_LOCAL_DNS_MODE:-${DEVCONTAINER_LOCAL_DNS_CACHE_MODE:-local}}"
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
RESOLV_BACKUP_META_FILE="${DEVCONTAINER_LOCAL_DNS_RESOLV_BACKUP_META_FILE:-${RESOLV_BACKUP_FILE}.meta}"
readonly RESOLV_BACKUP_META_FILE
ACTION_SUMMARY_FILE="${DEVCONTAINER_LOCAL_DNS_ACTION_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.action.summary}"
readonly ACTION_SUMMARY_FILE
EVENTS_FILE="${DEVCONTAINER_LOCAL_DNS_EVENTS_FILE:-/tmp/devcontainer-local-dns-cache.events.tsv}"
readonly EVENTS_FILE
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
RESTORE_RESOLV_CONF_ON_FAILURE="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_RESTORE_RESOLV_CONF_ON_FAILURE:-true}" true)"
readonly RESTORE_RESOLV_CONF_ON_FAILURE
ALLOW_STALE_RESOLV_BACKUP_RESTORE="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_ALLOW_STALE_RESOLV_BACKUP_RESTORE:-false}" false)"
readonly ALLOW_STALE_RESOLV_BACKUP_RESTORE
PRESERVE_RESOLV_SEARCH="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_PRESERVE_RESOLV_SEARCH:-true}" true)"
readonly PRESERVE_RESOLV_SEARCH
DNS_DOMAIN_NEEDED="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_DOMAIN_NEEDED:-true}" true)"
readonly DNS_DOMAIN_NEEDED
DOCKER_EMBEDDED_RESOLVER="${DEVCONTAINER_LOCAL_DNS_DOCKER_EMBEDDED_RESOLVER:-127.0.0.11}"
readonly DOCKER_EMBEDDED_RESOLVER
DOCKER_EMBEDDED_DNS_MODE="${DEVCONTAINER_LOCAL_DNS_DOCKER_EMBEDDED_MODE:-auto}"
case "${DOCKER_EMBEDDED_DNS_MODE}" in
    auto | off | prefer | fallback | split | generic) : ;;
    *) DOCKER_EMBEDDED_DNS_MODE="auto" ;;
esac
readonly DOCKER_EMBEDDED_DNS_MODE
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
DNS_LOOP_DETECT="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_LOOP_DETECT:-true}" true)"
readonly DNS_LOOP_DETECT
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
REPAIR_STALE_PIDFILE="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_REPAIR_STALE_PIDFILE:-true}" true)"
readonly REPAIR_STALE_PIDFILE
UPDATE_RUNTIME_SUMMARY_FOR_ACTIONS="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_ACTION_UPDATE_RUNTIME_SUMMARY:-false}" false)"
readonly UPDATE_RUNTIME_SUMMARY_FOR_ACTIONS
DNS_WARMUP="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_WARMUP:-true}" true)"
readonly DNS_WARMUP
DNS_WARMUP_HOSTS="${DEVCONTAINER_LOCAL_DNS_WARMUP_HOSTS:-${DNS_BENCHMARK_HOSTS}}"
readonly DNS_WARMUP_HOSTS
DNS_WARMUP_RECORD_TYPES="${DEVCONTAINER_LOCAL_DNS_WARMUP_RECORD_TYPES:-A}"
readonly DNS_WARMUP_RECORD_TYPES
DNS_WARMUP_MAX_HOSTS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_WARMUP_MAX_HOSTS:-12}" 12 1 64)"
readonly DNS_WARMUP_MAX_HOSTS
REQUIRE_PROVEN_LOCAL_PROBE_FOR_RESOLV_CONF="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_REQUIRE_PROVEN_LOCAL_PROBE_FOR_RESOLV_CONF:-true}" true)"
readonly REQUIRE_PROVEN_LOCAL_PROBE_FOR_RESOLV_CONF
ALLOW_PROCESS_ONLY_LOCAL_PROBE="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_ALLOW_PROCESS_ONLY_LOCAL_PROBE:-false}" false)"
readonly ALLOW_PROCESS_ONLY_LOCAL_PROBE
DOCKER_EMBEDDED_ROUTE_UNQUALIFIED="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_DOCKER_EMBEDDED_ROUTE_UNQUALIFIED:-true}" true)"
readonly DOCKER_EMBEDDED_ROUTE_UNQUALIFIED
DOCKER_EMBEDDED_ROUTE_SEARCH_DOMAINS="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_DOCKER_EMBEDDED_ROUTE_SEARCH_DOMAINS:-true}" true)"
readonly DOCKER_EMBEDDED_ROUTE_SEARCH_DOMAINS
REBIND_OK_DOCKER_DOMAINS="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_REBIND_OK_DOCKER_DOMAINS:-true}" true)"
readonly REBIND_OK_DOCKER_DOMAINS

# Persistent upstream ranking and health/staleness controls.
RANKING_FILE="${DEVCONTAINER_LOCAL_DNS_RANKING_FILE:-${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/devcontainer/network/dns-upstream-ranking.tsv}"
readonly RANKING_FILE
RANKING_STATE_FILE="${DEVCONTAINER_LOCAL_DNS_RANKING_STATE_FILE:-${RUNTIME_DIR}/dns-upstream-ranking.state}"
readonly RANKING_STATE_FILE
RANKING_LOCK_FILE="${DEVCONTAINER_LOCAL_DNS_RANKING_LOCK_FILE:-${RANKING_FILE}.lock}"
readonly RANKING_LOCK_FILE
RANKING_LOCK_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_RANKING_LOCK_WAIT_SECONDS:-${LOCK_WAIT_SECONDS}}" "${LOCK_WAIT_SECONDS}" 0 300)"
readonly RANKING_LOCK_WAIT_SECONDS
RANKING_MAX_AGE_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_RANKING_MAX_AGE_SECONDS:-86400}" 86400 60 2592000)"
readonly RANKING_MAX_AGE_SECONDS
RANKING_REBENCHMARK_MIN_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_REBENCHMARK_MIN_SECONDS:-900}" 900 0 86400)"
readonly RANKING_REBENCHMARK_MIN_SECONDS
RANKING_HYSTERESIS_SCORE_MARGIN="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_RANKING_HYSTERESIS_SCORE_MARGIN:-5000}" 5000 0 10000000)"
readonly RANKING_HYSTERESIS_SCORE_MARGIN
RANKING_FORCE_REBENCHMARK="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_FORCE_REBENCHMARK:-false}" false)"
readonly RANKING_FORCE_REBENCHMARK
RANKING_REBENCHMARK_ON_START="$(cfg_bool "${DEVCONTAINER_LOCAL_DNS_REBENCHMARK_ON_START:-false}" false)"
readonly RANKING_REBENCHMARK_ON_START
STATUS_STALE_MAX_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_DNS_STATUS_STALE_MAX_SECONDS:-0}" 0 0 604800)"
readonly STATUS_STALE_MAX_SECONDS
SELECTED_UPSTREAMS=""
UPSTREAM_COUNT="0"
RESOLV_CONF_SEARCH_LINE="none"
RESOLV_CONF_DOMAIN_LINE="none"
RESOLV_BACKUP_TRUST_STATUS="unknown"
DOCKER_EMBEDDED_RESOLVER_DETECTED="unknown"
DOCKER_EMBEDDED_UPSTREAM_STATUS="unknown"
DOCKER_EMBEDDED_SPLIT_STATUS="unknown"
DOCKER_EMBEDDED_SPLIT_DOMAINS="none"
DNSMASQ_TARGET_PORT_CONFLICT_STATUS="unknown"
RESOLV_CONF_WRITE_PRIVILEGE_STATUS="unknown"
DNSMASQ_OPTION_COMPAT_STATUS="unknown"
WARMUP_STATUS="not-run"
WARMUP_HOSTS_COUNT="0"
WARMUP_OK_COUNT="0"
WARMUP_FAILED_COUNT="0"
LOCAL_PROBE_STATUS="unknown"
LOCAL_PROBE_TOOL="unknown"
LOCAL_PROBE_PROVEN="false"
LOCAL_PROBE_PROOF_REASON="not-run"
SYSTEM_PROBE_STATUS="unknown"
RESOLV_CONF_STATUS="unknown"
RANKING_SOURCE="unknown"
RANKING_STALE="unknown"
RANKING_REASON="unknown"
RANKING_LAST_BENCHMARK_AT="0"
DNSMASQ_PID_EFFECTIVE="unknown"
DNSMASQ_PROCESS_STATUS="unknown"
DNSMASQ_PORT_STATUS="unknown"
DNSMASQ_SOCKET_PIDS="unknown"
DNSMASQ_SOCKET_DNSMASQ_PIDS="unknown"
DNSMASQ_SOCKET_NON_DNSMASQ_PIDS="unknown"
DNSMASQ_SOCKET_OWNER_VISIBILITY="unknown"
DNSMASQ_PIDFILE_STATUS="unknown"
RESOLV_CONF_HEALTH="unknown"
RESOLV_CONF_NAMESERVERS="unknown"
RESOLV_CONF_FIRST_NAMESERVER="unknown"
RESOLV_CONF_MTIME_EPOCH="0"
RESOLV_CONF_INODE="unknown"
RESOLV_CONF_SHA256="unknown"
RESOLV_CONF_DRIFT="unknown"
RESOLV_CONF_DRIFT_REASON="unknown"
RESOLV_CONF_SUMMARY_AGE_SECONDS="unknown"
RESOLV_CONF_POINTS_TO_CACHE="unknown"
RESOLV_CONF_MANAGED="unknown"
SYSTEM_RESOLVER_USES_CACHE="unknown"
RUNTIME_EFFECTIVE="unknown"
RESOLVER_EFFECTIVE="unknown"
PREVIOUS_SUMMARY_STALE="unknown"
PREVIOUS_SUMMARY_STALE_REASON="unknown"
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

read_first_line() {
    local file fallback line
    file="${1:-}"
    fallback="${2:-}"
    if [[ -r "${file}" ]]; then
        IFS= read -r line < "${file}" 2> /dev/null || line=""
        if [[ -n "${line}" ]]; then
            printf '%s' "${line}"
            return 0
        fi
    fi
    printf '%s' "${fallback}"
}

runtime_action_requires_dnsmasq() {
    case "${ACTION}" in
        start | restart | health | probe | status) return 0 ;;
        *) return 1 ;;
    esac
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
        printf 'dns_loop_detect=%s\n' "${DNS_LOOP_DETECT}"
        printf 'probe_host=%s\n' "${PROBE_HOST}"
        printf 'write_resolv_conf=%s\n' "${WRITE_RESOLV_CONF}"
        printf 'read_etc_hosts=%s\n' "${READ_ETC_HOSTS}"
        printf 'log_queries=%s\n' "${LOG_QUERIES}"
        printf 'all_servers=%s\n' "${DNS_ALL_SERVERS}"
        printf 'strict_order=%s\n' "${DNS_STRICT_ORDER}"
        printf 'use_stale_cache=%s\n' "${DNS_USE_STALE_CACHE}"
        printf 'takeover_stale_dnsmasq=%s\n' "${TAKEOVER_STALE_DNSMASQ}"
        printf 'restore_resolv_conf_on_failure=%s\n' "${RESTORE_RESOLV_CONF_ON_FAILURE}"
        printf 'allow_stale_resolv_backup_restore=%s\n' "${ALLOW_STALE_RESOLV_BACKUP_RESTORE}"
        printf 'preserve_resolv_search=%s\n' "${PRESERVE_RESOLV_SEARCH}"
        printf 'docker_embedded_dns_mode=%s\n' "${DOCKER_EMBEDDED_DNS_MODE}"
        printf 'docker_embedded_resolver=%s\n' "${DOCKER_EMBEDDED_RESOLVER}"
        printf 'dns_warmup=%s\n' "${DNS_WARMUP}"
        printf 'dns_warmup_hosts=%s\n' "${DNS_WARMUP_HOSTS}"
        printf 'require_proven_local_probe_for_resolv_conf=%s\n' "${REQUIRE_PROVEN_LOCAL_PROBE_FOR_RESOLV_CONF}"
        printf 'allow_process_only_local_probe=%s\n' "${ALLOW_PROCESS_ONLY_LOCAL_PROBE}"
        printf 'docker_embedded_route_unqualified=%s\n' "${DOCKER_EMBEDDED_ROUTE_UNQUALIFIED}"
        printf 'docker_embedded_route_search_domains=%s\n' "${DOCKER_EMBEDDED_ROUTE_SEARCH_DOMAINS}"
        printf 'rebind_ok_docker_domains=%s\n' "${REBIND_OK_DOCKER_DOMAINS}"
        printf 'dnsmasq_start_mode=%s\n' "${DNSMASQ_START_MODE}"
        printf 'prefer_unprivileged_dnsmasq=%s\n' "${PREFER_UNPRIVILEGED_DNSMASQ}"
        printf 'repair_on_probe_failure=%s\n' "${REPAIR_ON_PROBE_FAILURE}"
        printf 'repair_stale_pidfile=%s\n' "${REPAIR_STALE_PIDFILE}"
        printf 'ranking_file=%s\n' "${RANKING_FILE}"
        printf 'ranking_lock_wait_seconds=%s\n' "${RANKING_LOCK_WAIT_SECONDS}"
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

ensure_events_header() {
    if [[ ! -s "${EVENTS_FILE}" ]]; then
        printf '%s
' 'timestamp	event	severity	detail' | safe_write_file "${EVENTS_FILE}" 0644 || true
    fi
}

append_event() {
    local event severity detail
    event="${1:-event}"
    severity="${2:-info}"
    detail="${3:-}"
    ensure_parent_dir "${EVENTS_FILE}"
    ensure_events_header
    detail="$(printf '%s' "${detail}" | tr '

' '   ')"
    printf '%s	%s	%s	%s
' "$(ts)" "${event}" "${severity}" "${detail}" >> "${EVENTS_FILE}" 2> /dev/null || true
}

write_action_summary() {
    local status reason kind
    status="${1:-unknown}"
    reason="${2:-none}"
    kind="${3:-${ACTION}}"
    {
        printf 'summary_kind=action
'
        printf 'status=%s
' "${status}"
        printf 'reason=%s
' "${reason}"
        printf 'script_version=%s
' "${SCRIPT_VERSION}"
        printf 'action=%s
' "${kind}"
        printf 'mode=%s
' "${DNS_MODE}"
        printf 'selected_upstreams=%s
' "${SELECTED_UPSTREAMS:-unknown}"
        printf 'upstream_count=%s
' "${UPSTREAM_COUNT:-0}"
        printf 'ranking_source=%s
' "${RANKING_SOURCE:-unknown}"
        printf 'ranking_stale=%s
' "${RANKING_STALE:-unknown}"
        printf 'ranking_reason=%s
' "${RANKING_REASON:-unknown}"
        printf 'runtime_effective=%s
' "${RUNTIME_EFFECTIVE:-unknown}"
        printf 'resolver_effective=%s
' "${RESOLVER_EFFECTIVE:-unknown}"
        printf 'local_probe_tool=%s
' "${LOCAL_PROBE_TOOL:-unknown}"
        printf 'local_probe_proven=%s
' "${LOCAL_PROBE_PROVEN:-false}"
        printf 'local_probe_proof_reason=%s
' "${LOCAL_PROBE_PROOF_REASON:-unknown}"
        printf 'resolv_conf_drift=%s
' "${RESOLV_CONF_DRIFT:-unknown}"
        printf 'docker_embedded_resolver_detected=%s
' "${DOCKER_EMBEDDED_RESOLVER_DETECTED:-unknown}"
        printf 'docker_embedded_upstream_status=%s
' "${DOCKER_EMBEDDED_UPSTREAM_STATUS:-unknown}"
        printf 'docker_embedded_split_status=%s
' "${DOCKER_EMBEDDED_SPLIT_STATUS:-unknown}"
        printf 'docker_embedded_split_domains=%s
' "${DOCKER_EMBEDDED_SPLIT_DOMAINS:-none}"
        printf 'warmup_status=%s
' "${WARMUP_STATUS:-not-run}"
        printf 'warmup_hosts_count=%s
' "${WARMUP_HOSTS_COUNT:-0}"
        printf 'warmup_ok_count=%s
' "${WARMUP_OK_COUNT:-0}"
        printf 'warmup_failed_count=%s
' "${WARMUP_FAILED_COUNT:-0}"
        printf 'report=%s
' "${REPORT_FILE}"
        printf 'metrics=%s
' "${METRICS_FILE}"
        printf 'events=%s
' "${EVENTS_FILE}"
        printf 'completed_at=%s
' "$(ts)"
    } | safe_write_file "${ACTION_SUMMARY_FILE}" 0644 || true
}

managed_dnsmasq_runtime_running() {
    case "${DNSMASQ_PROCESS_STATUS:-unknown}" in
        running-managed | running-managed-no-pidfile | running-managed-stale-pidfile) return 0 ;;
        *) return 1 ;;
    esac
}

runtime_effective_from_current_state() {
    managed_dnsmasq_runtime_running || return 1
    case "${DNSMASQ_PORT_STATUS:-unknown}" in
        bound-managed | bound-managed-no-pidfile | bound-managed-stale-pidfile | bound-managed-unknown-port | free-or-unobserved) : ;;
        *) return 1 ;;
    esac
    case "${LOCAL_PROBE_STATUS:-unknown}" in
        ok | ok-dig | ok-drill | ok-nslookup)
            [[ "${LOCAL_PROBE_PROVEN:-false}" == "true" ]] && return 0
            return 2
            ;;
        ok-process-only)
            # Process presence alone is not enough for default-on resolver
            # governance. It is useful as an advisory status, but not proof that
            # /etc/resolv.conf can safely be pointed at the cache.
            return 2
            ;;
        unknown)
            # During early collection a local probe may not have run yet. In that
            # case, a managed process plus a non-conflicting port is promising but
            # not proven.
            return 2
            ;;
        *) return 1 ;;
    esac
}

resolver_effective_from_current_state() {
    [[ "${WRITE_RESOLV_CONF}" == "true" ]] || return 2
    [[ "${RESOLV_CONF_POINTS_TO_CACHE:-false}" == "true" ]] || return 1
    case "${SYSTEM_PROBE_STATUS:-unknown}" in
        ok | ok-*) return 0 ;;
        unknown) return 2 ;;
        *) return 1 ;;
    esac
}

resolv_conf_state_refresh() {
    local nameservers first_ns search_line domain_line
    if [[ -r /etc/resolv.conf ]]; then
        nameservers="$(awk '$1 == "nameserver" {printf "%s%s", sep, $2; sep=" "}' /etc/resolv.conf 2> /dev/null || true)"
        first_ns="$(awk '$1 == "nameserver" {print $2; exit}' /etc/resolv.conf 2> /dev/null || true)"
        search_line="$(awk '$1 == "search" {line=$0} END{if(line!="") print line}' /etc/resolv.conf 2> /dev/null || true)"
        domain_line="$(awk '$1 == "domain" {line=$0} END{if(line!="") print line}' /etc/resolv.conf 2> /dev/null || true)"
        RESOLV_CONF_NAMESERVERS="${nameservers:-none}"
        RESOLV_CONF_FIRST_NAMESERVER="${first_ns:-none}"
        RESOLV_CONF_SEARCH_LINE="${search_line:-none}"
        RESOLV_CONF_DOMAIN_LINE="${domain_line:-none}"
        if printf '%s
' "${nameservers}" | awk -v docker_ns="${DOCKER_EMBEDDED_RESOLVER}" '{for (i=1;i<=NF;i++) if ($i == docker_ns) found=1} END{exit found?0:1}'; then
            DOCKER_EMBEDDED_RESOLVER_DETECTED="true"
        else
            DOCKER_EMBEDDED_RESOLVER_DETECTED="false"
        fi
        RESOLV_CONF_MTIME_EPOCH="$(file_mtime_epoch /etc/resolv.conf)"
        RESOLV_CONF_INODE="$(stat -c '%i' /etc/resolv.conf 2> /dev/null || printf 'unknown')"
        if has_cmd sha256sum; then
            RESOLV_CONF_SHA256="$(sha256sum /etc/resolv.conf 2> /dev/null | awk '{print $1; exit}' || printf 'unknown')"
        elif has_cmd cksum; then
            RESOLV_CONF_SHA256="cksum:$(cksum /etc/resolv.conf 2> /dev/null | awk '{print $1":"$2; exit}' || printf 'unknown')"
        else
            RESOLV_CONF_SHA256="unavailable"
        fi
        if resolv_conf_is_managed; then
            RESOLV_CONF_MANAGED="true"
        else
            RESOLV_CONF_MANAGED="false"
        fi
        if verify_resolv_conf_points_to_cache && [[ "${DNS_BIND_PORT}" == "53" ]]; then
            RESOLV_CONF_POINTS_TO_CACHE="true"
            if [[ "${RESOLV_CONF_MANAGED}" == "true" ]]; then
                RESOLV_CONF_HEALTH="managed-points-to-cache"
            else
                RESOLV_CONF_HEALTH="points-to-cache-unmanaged"
            fi
        elif verify_resolv_conf_points_to_cache; then
            RESOLV_CONF_POINTS_TO_CACHE="false"
            RESOLV_CONF_HEALTH="points-to-cache-address-but-nonstandard-port"
        elif [[ "${RESOLV_CONF_MANAGED}" == "true" ]]; then
            RESOLV_CONF_POINTS_TO_CACHE="false"
            RESOLV_CONF_HEALTH="managed-stale-not-pointing-to-cache"
        else
            RESOLV_CONF_POINTS_TO_CACHE="false"
            RESOLV_CONF_HEALTH="points-elsewhere"
        fi
    else
        RESOLV_CONF_NAMESERVERS="unreadable"
        RESOLV_CONF_FIRST_NAMESERVER="unreadable"
        RESOLV_CONF_SEARCH_LINE="unreadable"
        RESOLV_CONF_DOMAIN_LINE="unreadable"
        DOCKER_EMBEDDED_RESOLVER_DETECTED="unknown"
        RESOLV_CONF_MTIME_EPOCH="0"
        RESOLV_CONF_INODE="unknown"
        RESOLV_CONF_SHA256="unreadable"
        RESOLV_CONF_MANAGED="unknown"
        RESOLV_CONF_POINTS_TO_CACHE="false"
        RESOLV_CONF_HEALTH="unreadable"
    fi
}

compute_resolv_conf_drift_from_previous_summary() {
    local old_status old_nameservers old_points old_mtime old_inode old_hash summary_mtime now age
    RESOLV_CONF_DRIFT="false"
    RESOLV_CONF_DRIFT_REASON="current-runtime-evaluated"
    RESOLV_CONF_SUMMARY_AGE_SECONDS="unknown"
    [[ -r "${SUMMARY_FILE}" ]] || return 0

    old_status="$(summary_value_from_file "${SUMMARY_FILE}" status)"
    old_nameservers="$(summary_value_from_file "${SUMMARY_FILE}" resolv_conf_nameservers)"
    old_points="$(summary_value_from_file "${SUMMARY_FILE}" resolv_conf_points_to_cache)"
    old_mtime="$(summary_value_from_file "${SUMMARY_FILE}" resolv_conf_mtime_epoch)"
    old_inode="$(summary_value_from_file "${SUMMARY_FILE}" resolv_conf_inode)"
    old_hash="$(summary_value_from_file "${SUMMARY_FILE}" resolv_conf_sha256)"
    summary_mtime="$(file_mtime_epoch "${SUMMARY_FILE}")"
    now="$(now_epoch)"
    if is_nonnegative_int "${now}" && is_nonnegative_int "${summary_mtime}" && ((summary_mtime > 0 && now >= summary_mtime)); then
        age=$((now - summary_mtime))
        RESOLV_CONF_SUMMARY_AGE_SECONDS="${age}"
    fi

    if [[ "${old_status}" == "ok" || "${old_points}" == "true" ]]; then
        if [[ "${old_points}" == "true" && "${RESOLV_CONF_POINTS_TO_CACHE}" != "true" ]]; then
            RESOLV_CONF_DRIFT="true"
            RESOLV_CONF_DRIFT_REASON="previous-summary-claimed-cache-current-resolv-conf-does-not"
            return 0
        fi
        if [[ -n "${old_nameservers}" && "${old_nameservers}" != "${RESOLV_CONF_NAMESERVERS}" ]]; then
            RESOLV_CONF_DRIFT="true"
            RESOLV_CONF_DRIFT_REASON="nameservers-changed-since-summary"
            return 0
        fi
        if [[ -n "${old_inode}" && "${old_inode}" != "unknown" && "${old_inode}" != "${RESOLV_CONF_INODE}" ]]; then
            RESOLV_CONF_DRIFT="true"
            RESOLV_CONF_DRIFT_REASON="inode-changed-since-summary"
            return 0
        fi
        if [[ -n "${old_hash}" && "${old_hash}" != "unknown" && "${old_hash}" != "unavailable" && "${old_hash}" != "${RESOLV_CONF_SHA256}" ]]; then
            RESOLV_CONF_DRIFT="true"
            RESOLV_CONF_DRIFT_REASON="content-hash-changed-since-summary"
            return 0
        fi
        if [[ -n "${old_mtime}" && "${old_mtime}" =~ ^[0-9]+$ && "${RESOLV_CONF_MTIME_EPOCH}" =~ ^[0-9]+$ && "${old_mtime}" != "${RESOLV_CONF_MTIME_EPOCH}" ]]; then
            # mtime alone is lower-confidence than nameserver/hash/inode, but it is
            # valuable forensic evidence for post-attach when another process rewrites
            # /etc/resolv.conf between lifecycle phases.
            RESOLV_CONF_DRIFT="possible"
            RESOLV_CONF_DRIFT_REASON="mtime-changed-since-summary"
        fi
    fi
}

ss_listen_lines_for_port() {
    local port address
    port="${1:-${DNS_BIND_PORT}}"
    address="${2:-}"
    has_cmd ss || return 0
    {
        ss -H -lnup 2> /dev/null || true
        ss -H -lntp 2> /dev/null || true
        ss -H -lntu 2> /dev/null || true
    } | awk -v p="${port}" -v addr="${address}" '
        function normalize_host(field, host) {
            host=field
            sub(/:[0-9]+$/, "", host)
            gsub(/^\[/, "", host)
            gsub(/\]$/, "", host)
            return host
        }
        function host_matches(host) {
            if (addr == "") return 1
            if (host == addr) return 1
            if (host == "*" || host == "0.0.0.0") return 1
            if (host == "::" || host == "[::]") return 1
            return 0
        }
        {
            for (i = 1; i <= NF; i++) {
                field=$i
                if (field ~ ":" p "$") {
                    host=normalize_host(field)
                    if (host_matches(host)) { print; next }
                }
            }
        }
    ' | awk 'NF && !seen[$0]++'
}

socket_owner_lines() {
    [[ "${STOP_BY_SOCKET_OWNER}" == "true" ]] || return 0
    ss_listen_lines_for_port "${DNS_BIND_PORT}" "${DNS_BIND_ADDRESS}"
}

socket_owner_visibility_state() {
    local lines
    if ! has_cmd ss; then
        printf 'ss-unavailable'
        return 0
    fi
    lines="$(socket_owner_lines)"
    if [[ -z "${lines}" ]]; then
        printf 'none'
        return 0
    fi
    if printf '%s\n' "${lines}" | grep -q 'pid=[0-9]'; then
        printf 'visible'
    elif printf '%s\n' "${lines}" | grep -q 'users:'; then
        printf 'users-without-pid'
    else
        printf 'hidden-or-unavailable'
    fi
}

write_privileged_file_from_stdin() {
    local target mode tmp dir
    target="${1:-}"
    mode="${2:-0644}"
    [[ -n "${target}" ]] || return 1
    ensure_parent_dir "${target}"
    dir="$(dirname "${target}" 2> /dev/null || printf '/tmp')"
    tmp="$(mktemp "${dir%/}/.${SCRIPT_NAME}.priv.XXXXXX" 2> /dev/null || true)"
    [[ -n "${tmp}" ]] || return 1
    cat > "${tmp}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
    chmod "${mode}" "${tmp}" 2> /dev/null || true
    mv -f "${tmp}" "${target}" 2> /dev/null && return 0
    safe_sudo tee "${target}" < "${tmp}" > /dev/null 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
    safe_sudo chmod "${mode}" "${target}" 2> /dev/null || chmod "${mode}" "${target}" 2> /dev/null || true
    rm -f "${tmp}" 2> /dev/null || true
    return 0
}

repair_managed_pidfile_if_safe() {
    local discovered current status
    [[ "${REPAIR_STALE_PIDFILE}" == "true" ]] || return 1
    discovered="$(first_managed_dnsmasq_pid_by_cmdline)"
    [[ "${discovered}" =~ ^[0-9]+$ ]] || return 1
    pid_is_alive "${discovered}" || return 1
    current="$(read_dnsmasq_pid)"
    if [[ "${current}" == "${discovered}" ]]; then
        DNSMASQ_PIDFILE_STATUS="current"
        return 0
    fi
    status="missing"
    if [[ -n "${current}" ]]; then
        if pid_is_alive "${current}"; then
            status="different-live-${current}"
        else
            status="stale-dead-${current}"
        fi
    fi
    if printf '%s\n' "${discovered}" | write_privileged_file_from_stdin "${DNSMASQ_PID_FILE}" 0644; then
        DNSMASQ_PIDFILE_STATUS="repaired-from-${status}-to-${discovered}"
        append_report "dnsmasq_pidfile_repaired old=${current:-none} new=${discovered} status=${status}"
        return 0
    fi
    DNSMASQ_PIDFILE_STATUS="repair-failed-from-${status}-to-${discovered}"
    append_report "dnsmasq_pidfile_repair_failed old=${current:-none} new=${discovered} status=${status}"
    return 1
}

collect_socket_pid_state() {
    local pid comm pids dns_pids other_pids visibility
    pids=""
    dns_pids=""
    other_pids=""
    visibility="$(socket_owner_visibility_state)"
    while IFS= read -r pid; do
        [[ -n "${pid}" ]] || continue
        if [[ -z "${pids}" ]]; then pids="${pid}"; else pids="${pids} ${pid}"; fi
        if process_is_dnsmasq "${pid}"; then
            if [[ -z "${dns_pids}" ]]; then dns_pids="${pid}"; else dns_pids="${dns_pids} ${pid}"; fi
        else
            comm="$(awk 'NR == 1 {print; exit}' "/proc/${pid}/comm" 2> /dev/null || printf unknown)"
            if [[ -z "${other_pids}" ]]; then other_pids="${pid}:${comm}"; else other_pids="${other_pids} ${pid}:${comm}"; fi
        fi
    done < <(socket_dnsmasq_pids)
    DNSMASQ_SOCKET_OWNER_VISIBILITY="${visibility:-unknown}"
    if [[ -z "${pids}" && "${visibility}" != "none" && "${visibility}" != "ss-unavailable" ]]; then
        DNSMASQ_SOCKET_PIDS="unavailable"
        DNSMASQ_SOCKET_DNSMASQ_PIDS="unavailable"
        DNSMASQ_SOCKET_NON_DNSMASQ_PIDS="unavailable"
    else
        DNSMASQ_SOCKET_PIDS="${pids:-none}"
        DNSMASQ_SOCKET_DNSMASQ_PIDS="${dns_pids:-none}"
        DNSMASQ_SOCKET_NON_DNSMASQ_PIDS="${other_pids:-none}"
    fi
}

collect_runtime_health() {
    local stale_mode pid nameservers summary_status summary_fp current_fp status_mtime age now pid_cmdline discovered_pid rt_rc resolver_rc
    stale_mode="${1:-read-current-summary}"
    pid="$(read_dnsmasq_pid)"
    discovered_pid="$(first_managed_dnsmasq_pid_by_cmdline)"
    DNSMASQ_PID_EFFECTIVE="${pid:-${discovered_pid:-none}}"
    DNSMASQ_PROCESS_STATUS="stopped"
    DNSMASQ_PIDFILE_STATUS="unknown"
    if [[ -z "${pid}" ]]; then
        DNSMASQ_PIDFILE_STATUS="missing"
    elif pid_is_alive "${pid}"; then
        DNSMASQ_PIDFILE_STATUS="live"
    else
        DNSMASQ_PIDFILE_STATUS="stale-dead"
    fi

    if [[ -n "${pid}" ]]; then
        if pid_is_alive "${pid}"; then
            if managed_dnsmasq_pid_is_alive; then
                DNSMASQ_PROCESS_STATUS="running-managed"
            elif [[ -n "${discovered_pid}" && "${discovered_pid}" != "${pid}" ]]; then
                DNSMASQ_PID_EFFECTIVE="${discovered_pid}"
                DNSMASQ_PROCESS_STATUS="running-managed-stale-pidfile"
            elif process_is_dnsmasq "${pid}"; then
                DNSMASQ_PROCESS_STATUS="running-dnsmasq-unmanaged-pidfile"
            else
                DNSMASQ_PROCESS_STATUS="pidfile-non-dnsmasq"
            fi
        else
            if [[ -n "${discovered_pid}" ]]; then
                DNSMASQ_PID_EFFECTIVE="${discovered_pid}"
                DNSMASQ_PROCESS_STATUS="running-managed-stale-pidfile"
            else
                DNSMASQ_PROCESS_STATUS="stale-pidfile-dead"
            fi
        fi
    elif [[ -n "${discovered_pid}" ]]; then
        DNSMASQ_PID_EFFECTIVE="${discovered_pid}"
        DNSMASQ_PROCESS_STATUS="running-managed-no-pidfile"
    fi

    if [[ "${DNSMASQ_PROCESS_STATUS}" == "running-managed-stale-pidfile" || "${DNSMASQ_PROCESS_STATUS}" == "running-managed-no-pidfile" ]]; then
        repair_managed_pidfile_if_safe || true
        pid="$(read_dnsmasq_pid)"
        discovered_pid="$(first_managed_dnsmasq_pid_by_cmdline)"
        if [[ -n "${pid}" && -n "${discovered_pid}" && "${pid}" == "${discovered_pid}" ]]; then
            DNSMASQ_PID_EFFECTIVE="${pid}"
            DNSMASQ_PROCESS_STATUS="running-managed"
            [[ "${DNSMASQ_PIDFILE_STATUS}" == repaired-* ]] || DNSMASQ_PIDFILE_STATUS="current"
        fi
    fi

    collect_socket_pid_state
    if [[ "${STRICT_PORT_CHECK}" == "true" ]] && port_in_use "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
        case "${DNSMASQ_PROCESS_STATUS}" in
            running-managed) DNSMASQ_PORT_STATUS="bound-managed" ;;
            running-managed-no-pidfile) DNSMASQ_PORT_STATUS="bound-managed-no-pidfile" ;;
            running-managed-stale-pidfile) DNSMASQ_PORT_STATUS="bound-managed-stale-pidfile" ;;
            running-dnsmasq-unmanaged-pidfile) DNSMASQ_PORT_STATUS="bound-dnsmasq-unmanaged-pidfile" ;;
            *)
                if [[ "${DNSMASQ_SOCKET_DNSMASQ_PIDS}" != "none" && "${DNSMASQ_SOCKET_DNSMASQ_PIDS}" != "unavailable" ]]; then
                    DNSMASQ_PORT_STATUS="bound-dnsmasq-unmanaged"
                elif [[ "${DNSMASQ_SOCKET_OWNER_VISIBILITY}" != "visible" && "${DNSMASQ_SOCKET_OWNER_VISIBILITY}" != "none" ]]; then
                    DNSMASQ_PORT_STATUS="bound-owner-unavailable"
                else
                    DNSMASQ_PORT_STATUS="bound-unmanaged"
                fi
                ;;
        esac
    else
        if managed_dnsmasq_runtime_running; then
            DNSMASQ_PORT_STATUS="bound-managed-unknown-port"
        else
            DNSMASQ_PORT_STATUS="free-or-unobserved"
        fi
    fi

    resolv_conf_state_refresh

    current_fp="$(container_fingerprint)"
    CONTAINER_FINGERPRINT="${current_fp:-unknown}"
    summary_status=""
    summary_fp=""
    PREVIOUS_SUMMARY_STALE="false"
    PREVIOUS_SUMMARY_STALE_REASON="fresh-or-unavailable"
    STATUS_STALE="false"
    STATUS_STALE_REASON="current-runtime-evaluated"

    if [[ "${stale_mode}" != "writing-summary" ]]; then
        summary_status="$(summary_value_from_file "${SUMMARY_FILE}" status)"
        summary_fp="$(summary_value_from_file "${SUMMARY_FILE}" container_fingerprint)"
        if [[ -n "${summary_fp}" && "${summary_fp}" != "${current_fp}" ]]; then
            PREVIOUS_SUMMARY_STALE="true"
            PREVIOUS_SUMMARY_STALE_REASON="summary-from-different-container-init"
        elif [[ "${STATUS_STALE_MAX_SECONDS}" -gt 0 && -e "${SUMMARY_FILE}" ]]; then
            now="$(now_epoch)"
            status_mtime="$(file_mtime_epoch "${SUMMARY_FILE}")"
            age=$((now - status_mtime))
            if ((age > STATUS_STALE_MAX_SECONDS)); then
                PREVIOUS_SUMMARY_STALE="true"
                PREVIOUS_SUMMARY_STALE_REASON="summary-age-exceeded-${STATUS_STALE_MAX_SECONDS}s"
            fi
        fi
        compute_resolv_conf_drift_from_previous_summary
    else
        RESOLV_CONF_DRIFT="false"
        RESOLV_CONF_DRIFT_REASON="writing-current-summary"
        RESOLV_CONF_SUMMARY_AGE_SECONDS="0"
    fi

    if [[ "${summary_status}" == "ok" ]] && runtime_action_requires_dnsmasq; then
        if [[ "${WRITE_RESOLV_CONF}" == "true" && "${RESOLV_CONF_POINTS_TO_CACHE}" != "true" ]]; then
            STATUS_STALE="true"
            STATUS_STALE_REASON="previous-ok-but-current-resolv-conf-not-pointing-to-cache"
        elif [[ "${RESOLV_CONF_DRIFT}" == "true" ]]; then
            STATUS_STALE="true"
            STATUS_STALE_REASON="resolv-conf-drift:${RESOLV_CONF_DRIFT_REASON}"
        elif ! managed_dnsmasq_runtime_running; then
            STATUS_STALE="true"
            STATUS_STALE_REASON="previous-ok-but-current-dnsmasq-not-managed-running"
        fi
    fi

    runtime_effective_from_current_state
    rt_rc=$?
    case "${rt_rc}" in
        0) RUNTIME_EFFECTIVE="true" ;;
        2) RUNTIME_EFFECTIVE="unknown" ;;
        *) RUNTIME_EFFECTIVE="false" ;;
    esac

    resolver_effective_from_current_state
    resolver_rc=$?
    case "${resolver_rc}" in
        0)
            RESOLVER_EFFECTIVE="true"
            SYSTEM_RESOLVER_USES_CACHE="true"
            ;;
        2)
            RESOLVER_EFFECTIVE="unknown"
            if [[ "${RESOLV_CONF_POINTS_TO_CACHE}" == "true" ]]; then
                SYSTEM_RESOLVER_USES_CACHE="unknown"
            else
                SYSTEM_RESOLVER_USES_CACHE="false"
            fi
            ;;
        *)
            RESOLVER_EFFECTIVE="false"
            SYSTEM_RESOLVER_USES_CACHE="false"
            ;;
    esac

    if [[ -n "${pid}" && -r "/proc/${pid}/cmdline" ]]; then
        pid_cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2> /dev/null || true)"
        append_report "dnsmasq_runtime pid=${pid} effective_pid=${DNSMASQ_PID_EFFECTIVE} status=${DNSMASQ_PROCESS_STATUS} port=${DNSMASQ_PORT_STATUS} socket_pids=${DNSMASQ_SOCKET_PIDS} cmdline=${pid_cmdline}"
    else
        append_report "dnsmasq_runtime pid=${DNSMASQ_PID_EFFECTIVE} status=${DNSMASQ_PROCESS_STATUS} port=${DNSMASQ_PORT_STATUS} socket_pids=${DNSMASQ_SOCKET_PIDS}"
    fi
    append_report "resolv_conf_health=${RESOLV_CONF_HEALTH} nameservers=${RESOLV_CONF_NAMESERVERS} first_nameserver=${RESOLV_CONF_FIRST_NAMESERVER} mtime=${RESOLV_CONF_MTIME_EPOCH} inode=${RESOLV_CONF_INODE} hash=${RESOLV_CONF_SHA256} points_to_cache=${RESOLV_CONF_POINTS_TO_CACHE} managed=${RESOLV_CONF_MANAGED} drift=${RESOLV_CONF_DRIFT} drift_reason=${RESOLV_CONF_DRIFT_REASON} runtime_effective=${RUNTIME_EFFECTIVE} resolver_effective=${RESOLVER_EFFECTIVE} local_probe=${LOCAL_PROBE_STATUS}/${LOCAL_PROBE_TOOL}/proven=${LOCAL_PROBE_PROVEN} docker_split=${DOCKER_EMBEDDED_SPLIT_STATUS}/${DOCKER_EMBEDDED_SPLIT_DOMAINS} status_stale=${STATUS_STALE} previous_summary_stale=${PREVIOUS_SUMMARY_STALE} stale_reason=${STATUS_STALE_REASON} previous_stale_reason=${PREVIOUS_SUMMARY_STALE_REASON}"
}

write_summary() {
    local status reason
    status="${1:-unknown}"
    reason="${2:-none}"
    collect_runtime_health "writing-summary"
    if [[ "${status}" == "ok" ]] && ! runtime_action_requires_dnsmasq; then
        STATUS_STALE="false"
        STATUS_STALE_REASON="not-runtime-action-${ACTION}"
    elif [[ "${status}" == "stale" ]]; then
        STATUS_STALE="true"
        STATUS_STALE_REASON="${reason}"
    elif [[ "${status}" != "ok" ]]; then
        STATUS_STALE="false"
        STATUS_STALE_REASON="not-applicable-for-${status}"
    fi
    {
        printf 'summary_kind=runtime\n'
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
        printf 'dnsmasq_socket_pids=%s\n' "${DNSMASQ_SOCKET_PIDS}"
        printf 'dnsmasq_socket_dnsmasq_pids=%s\n' "${DNSMASQ_SOCKET_DNSMASQ_PIDS}"
        printf 'dnsmasq_socket_non_dnsmasq_pids=%s\n' "${DNSMASQ_SOCKET_NON_DNSMASQ_PIDS}"
        printf 'dnsmasq_socket_owner_visibility=%s\n' "${DNSMASQ_SOCKET_OWNER_VISIBILITY}"
        printf 'dnsmasq_pidfile_status=%s\n' "${DNSMASQ_PIDFILE_STATUS}"
        printf 'local_probe_status=%s\n' "${LOCAL_PROBE_STATUS}"
        printf 'local_probe_tool=%s\n' "${LOCAL_PROBE_TOOL}"
        printf 'local_probe_proven=%s\n' "${LOCAL_PROBE_PROVEN}"
        printf 'local_probe_proof_reason=%s\n' "${LOCAL_PROBE_PROOF_REASON}"
        printf 'system_probe_status=%s\n' "${SYSTEM_PROBE_STATUS}"
        printf 'resolv_conf_status=%s\n' "${RESOLV_CONF_STATUS}"
        printf 'resolv_conf_health=%s\n' "${RESOLV_CONF_HEALTH}"
        printf 'resolv_conf_nameservers=%s\n' "${RESOLV_CONF_NAMESERVERS}"
        printf 'resolv_conf_search_line=%s\n' "${RESOLV_CONF_SEARCH_LINE}"
        printf 'resolv_conf_domain_line=%s\n' "${RESOLV_CONF_DOMAIN_LINE}"
        printf 'resolv_conf_first_nameserver=%s\n' "${RESOLV_CONF_FIRST_NAMESERVER}"
        printf 'resolv_conf_mtime_epoch=%s\n' "${RESOLV_CONF_MTIME_EPOCH}"
        printf 'resolv_conf_inode=%s\n' "${RESOLV_CONF_INODE}"
        printf 'resolv_conf_sha256=%s\n' "${RESOLV_CONF_SHA256}"
        printf 'resolv_conf_points_to_cache=%s\n' "${RESOLV_CONF_POINTS_TO_CACHE}"
        printf 'resolv_conf_managed=%s\n' "${RESOLV_CONF_MANAGED}"
        printf 'resolv_conf_drift=%s\n' "${RESOLV_CONF_DRIFT}"
        printf 'resolv_conf_drift_reason=%s\n' "${RESOLV_CONF_DRIFT_REASON}"
        printf 'resolv_conf_summary_age_seconds=%s\n' "${RESOLV_CONF_SUMMARY_AGE_SECONDS}"
        printf 'resolv_backup_trust_status=%s\n' "${RESOLV_BACKUP_TRUST_STATUS}"
        printf 'docker_embedded_resolver_detected=%s\n' "${DOCKER_EMBEDDED_RESOLVER_DETECTED}"
        printf 'docker_embedded_upstream_status=%s\n' "${DOCKER_EMBEDDED_UPSTREAM_STATUS}"
        printf 'docker_embedded_split_status=%s\n' "${DOCKER_EMBEDDED_SPLIT_STATUS}"
        printf 'docker_embedded_split_domains=%s\n' "${DOCKER_EMBEDDED_SPLIT_DOMAINS}"
        printf 'dnsmasq_target_port_conflict_status=%s\n' "${DNSMASQ_TARGET_PORT_CONFLICT_STATUS}"
        printf 'resolv_conf_write_privilege_status=%s\n' "${RESOLV_CONF_WRITE_PRIVILEGE_STATUS}"
        printf 'dnsmasq_option_compat_status=%s\n' "${DNSMASQ_OPTION_COMPAT_STATUS}"
        printf 'warmup_status=%s\n' "${WARMUP_STATUS}"
        printf 'warmup_hosts_count=%s\n' "${WARMUP_HOSTS_COUNT}"
        printf 'warmup_ok_count=%s\n' "${WARMUP_OK_COUNT}"
        printf 'warmup_failed_count=%s\n' "${WARMUP_FAILED_COUNT}"
        printf 'runtime_effective=%s\n' "${RUNTIME_EFFECTIVE}"
        printf 'resolver_effective=%s\n' "${RESOLVER_EFFECTIVE}"
        printf 'system_resolver_uses_cache=%s\n' "${SYSTEM_RESOLVER_USES_CACHE}"
        printf 'previous_summary_stale=%s\n' "${PREVIOUS_SUMMARY_STALE}"
        printf 'previous_summary_stale_reason=%s\n' "${PREVIOUS_SUMMARY_STALE_REASON}"
        printf 'status_stale=%s\n' "${STATUS_STALE}"
        printf 'status_stale_reason=%s\n' "${STATUS_STALE_REASON}"
        printf 'dnsmasq_conf=%s\n' "${DNSMASQ_CONF}"
        printf 'dnsmasq_pid_file=%s\n' "${DNSMASQ_PID_FILE}"
        printf 'dnsmasq_log_file=%s\n' "${DNSMASQ_LOG_FILE}"
        printf 'report=%s\n' "${REPORT_FILE}"
        printf 'metrics=%s\n' "${METRICS_FILE}"
        printf 'action_summary=%s\n' "${ACTION_SUMMARY_FILE}"
        printf 'events=%s\n' "${EVENTS_FILE}"
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

is_ipv4_unusable_nameserver() {
    local ip first
    ip="${1:-}"
    is_ipv4 "${ip}" || return 1
    first="${ip%%.*}"
    [[ "${ip}" == "0.0.0.0" || "${ip}" == "255.255.255.255" ]] && return 0
    [[ "${first}" =~ ^[0-9]+$ ]] || return 1
    ((first >= 224))
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

docker_embedded_resolver_should_be_considered() {
    case "${DOCKER_EMBEDDED_DNS_MODE}" in
        off) return 1 ;;
        prefer | fallback | split | generic) return 0 ;;
        auto)
            if [[ "${DOCKER_EMBEDDED_RESOLVER_DETECTED:-unknown}" == "true" ]]; then return 0; fi
            if [[ -r /etc/resolv.conf ]] && awk -v ns="${DOCKER_EMBEDDED_RESOLVER}" '$1=="nameserver" && $2==ns {found=1} END{exit found?0:1}' /etc/resolv.conf 2> /dev/null; then return 0; fi
            return 1
            ;;
    esac
    return 1
}

docker_embedded_generic_upstream_enabled() {
    docker_embedded_resolver_should_be_considered || return 1
    case "${DOCKER_EMBEDDED_DNS_MODE}" in
        prefer | fallback | generic) return 0 ;;
        auto | split) return 1 ;;
    esac
    return 1
}

docker_embedded_split_dns_enabled() {
    docker_embedded_resolver_should_be_considered || return 1
    case "${DOCKER_EMBEDDED_DNS_MODE}" in
        auto | split | prefer | fallback) return 0 ;;
        generic | off) return 1 ;;
    esac
    return 1
}

is_docker_embedded_resolver() {
    [[ "${1:-}" == "${DOCKER_EMBEDDED_RESOLVER}" ]]
}

is_safe_resolv_domain_token() {
    local token label old_ifs
    token="${1:-}"
    [[ -n "${token}" && ${#token} -le 253 ]] || return 1
    [[ "${token}" == "." ]] && return 0
    [[ "${token}" != *..* ]] || return 1
    [[ "${token}" =~ ^[A-Za-z0-9_.-]+$ ]] || return 1
    old_ifs="${IFS}"
    IFS='.'
    for label in ${token}; do
        [[ -z "${label}" ]] && continue
        [[ ${#label} -le 63 ]] || { IFS="${old_ifs}"; return 1; }
        [[ "${label}" =~ ^[A-Za-z0-9_]([A-Za-z0-9_-]*[A-Za-z0-9_])?$ ]] || { IFS="${old_ifs}"; return 1; }
    done
    IFS="${old_ifs}"
    return 0
}

safe_resolv_search_line_from_current() {
    [[ "${PRESERVE_RESOLV_SEARCH}" == "true" && -r /etc/resolv.conf ]] || return 0
    awk '
        $1 == "search" || $1 == "domain" {line=$0}
        END { if (line != "") print line }
    ' /etc/resolv.conf 2> /dev/null | while IFS= read -r line; do
        set -- ${line}
        key="${1:-}"
        shift || true
        [[ "${key}" == "search" || "${key}" == "domain" ]] || continue
        out="${key}"
        count=0
        for token in "$@"; do
            is_safe_resolv_domain_token "${token}" || continue
            out="${out} ${token}"
            count=$((count + 1))
            [[ "${count}" -ge 12 ]] && break
        done
        [[ "${count}" -gt 0 ]] && printf '%s\n' "${out}"
        break
    done
}


safe_resolv_search_domains_from_current() {
    local line key token count
    line="$(safe_resolv_search_line_from_current)"
    [[ -n "${line}" ]] || return 0
    set -- ${line}
    key="${1:-}"
    shift || true
    [[ "${key}" == "search" || "${key}" == "domain" ]] || return 0
    count=0
    for token in "$@"; do
        is_safe_resolv_domain_token "${token}" || continue
        printf '%s\n' "${token}"
        count=$((count + 1))
        [[ "${count}" -ge 12 ]] && break
    done
}

dnsmasq_safe_domain_pattern() {
    local token
    token="${1:-}"
    is_safe_resolv_domain_token "${token}" || return 1
    [[ "${token}" == "." ]] && return 1
    printf '%s' "${token}" | tr -c 'A-Za-z0-9._-' '-'
}

emit_docker_embedded_split_config_lines() {
    local domain domains any
    docker_embedded_split_dns_enabled || {
        DOCKER_EMBEDDED_SPLIT_STATUS="disabled"
        DOCKER_EMBEDDED_SPLIT_DOMAINS="none"
        return 0
    }

    any="false"
    domains=""
    if [[ "${DOCKER_EMBEDDED_ROUTE_UNQUALIFIED}" == "true" ]]; then
        printf 'server=//%s\n' "${DOCKER_EMBEDDED_RESOLVER}"
        any="true"
        domains="unqualified"
    fi

    if [[ "${DOCKER_EMBEDDED_ROUTE_SEARCH_DOMAINS}" == "true" ]]; then
        while IFS= read -r domain; do
            [[ -n "${domain}" ]] || continue
            domain="$(dnsmasq_safe_domain_pattern "${domain}")" || continue
            [[ -n "${domain}" ]] || continue
            printf 'server=/%s/%s\n' "${domain}" "${DOCKER_EMBEDDED_RESOLVER}"
            if [[ "${REBIND_OK_DOCKER_DOMAINS}" == "true" ]]; then
                printf 'rebind-domain-ok=/%s/\n' "${domain}"
            fi
            if [[ -z "${domains}" ]]; then domains="${domain}"; else domains="${domains},${domain}"; fi
            any="true"
        done < <(safe_resolv_search_domains_from_current)
    fi

    if [[ "${any}" == "true" ]]; then
        DOCKER_EMBEDDED_SPLIT_STATUS="enabled"
        DOCKER_EMBEDDED_SPLIT_DOMAINS="${domains:-unqualified}"
        append_report "docker_embedded_split_dns=enabled resolver=${DOCKER_EMBEDDED_RESOLVER} domains=${DOCKER_EMBEDDED_SPLIT_DOMAINS}"
    else
        DOCKER_EMBEDDED_SPLIT_STATUS="skipped-no-domains"
        DOCKER_EMBEDDED_SPLIT_DOMAINS="none"
        append_report "docker_embedded_split_dns=skipped-no-domains resolver=${DOCKER_EMBEDDED_RESOLVER}"
    fi
}

dnsmasq_config_line_supported() {
    local line tmp test_log rc
    line="${1:-}"
    [[ -n "${line}" ]] || return 1
    has_cmd dnsmasq || return 1
    tmp="$(make_temp_file dnsmasq-option-test /tmp)"
    [[ -n "${tmp}" ]] || return 1
    test_log="$(make_temp_file dnsmasq-option-test-log /tmp)"
    [[ -n "${test_log}" ]] || test_log="/dev/null"
    {
        printf 'no-resolv\n'
        printf 'no-hosts\n'
        printf 'port=0\n'
        printf 'cache-size=0\n'
        printf '%s\n' "${line}"
        printf 'server=1.1.1.1\n'
    } > "${tmp}" 2> /dev/null || { rm -f "${tmp}" "${test_log}" 2> /dev/null || true; return 1; }
    dnsmasq --test --conf-file="${tmp}" > "${test_log}" 2>&1
    rc=$?
    if [[ "${rc}" -ne 0 ]]; then
        append_report "dnsmasq_optional_line_unsupported line=${line} output=$(tr '\n' ' ' < "${test_log}" 2> /dev/null || true)"
    fi
    rm -f "${tmp}" "${test_log}" 2> /dev/null || true
    return "${rc}"
}

emit_dnsmasq_optional_config_line() {
    local line label
    line="${1:-}"
    label="${2:-${line}}"
    [[ -n "${line}" ]] || return 1
    if [[ "${DNS_VALIDATE_CONFIG}" == "true" && -n "${line}" ]]; then
        if ! dnsmasq_config_line_supported "${line}"; then
            DNSMASQ_OPTION_COMPAT_STATUS="skipped-${label}"
            append_event "dnsmasq-option-skipped" "warn" "${label}"
            return 1
        fi
    fi
    printf '%s\n' "${line}"
    DNSMASQ_OPTION_COMPAT_STATUS="ok"
    return 0
}

is_valid_nameserver() {
    if is_ipv4 "$1"; then
        if is_ipv4_unusable_nameserver "$1"; then
            return 1
        fi
        if is_ipv4_loopback "$1" && [[ "${ALLOW_LOOPBACK_UPSTREAMS}" != "true" ]]; then
            if is_docker_embedded_resolver "$1" && docker_embedded_generic_upstream_enabled; then
                return 0
            fi
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

managed_dnsmasq_pids_by_cmdline() {
    local proc pid cmdline
    for proc in /proc/[0-9]*; do
        [[ -d "${proc}" ]] || continue
        pid="${proc##*/}"
        [[ "${pid}" =~ ^[0-9]+$ ]] || continue
        [[ -r "${proc}/cmdline" ]] || continue
        cmdline="$(tr '\0' ' ' < "${proc}/cmdline" 2> /dev/null || true)"
        [[ "${cmdline}" == *"dnsmasq"* && "${cmdline}" == *"${DNSMASQ_CONF}"* ]] || continue
        printf '%s\n' "${pid}"
    done
}

first_managed_dnsmasq_pid_by_cmdline() {
    managed_dnsmasq_pids_by_cmdline | awk 'NF {print; exit}'
}

dnsmasq_is_running() {
    local pid
    managed_dnsmasq_pid_is_alive && return 0
    pid="$(first_managed_dnsmasq_pid_by_cmdline)"
    [[ -n "${pid}" ]]
}

port_in_use() {
    local address port
    address="${1:-127.0.0.1}"
    port="${2:-53}"
    DNSMASQ_TARGET_PORT_CONFLICT_STATUS="unknown"
    if has_cmd ss; then
        if ss_listen_lines_for_port "${port}" "${address}" | awk 'NF{found=1} END{exit found?0:1}'; then
            DNSMASQ_TARGET_PORT_CONFLICT_STATUS="in-use"
            return 0
        fi
        DNSMASQ_TARGET_PORT_CONFLICT_STATUS="free"
        return 1
    fi
    DNSMASQ_TARGET_PORT_CONFLICT_STATUS="unknown-no-ss"
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
    local upstream emitted docker_emitted
    emitted=""
    docker_emitted="false"

    if [[ "${DOCKER_EMBEDDED_DNS_MODE}" == "prefer" ]] && docker_embedded_generic_upstream_enabled; then
        printf '%s
' "${DOCKER_EMBEDDED_RESOLVER}"
        emitted="${DOCKER_EMBEDDED_RESOLVER}"
        docker_emitted="true"
    fi

    for upstream in ${DNS_UPSTREAMS}; do
        if is_valid_nameserver "${upstream}"; then
            if ! printf '%s
' "${emitted}" | awk -v u="${upstream}" '$0 == u {found=1} END{exit found?0:1}'; then
                printf '%s
' "${upstream}"
                emitted="${emitted}${emitted:+
}${upstream}"
            fi
        else
            append_report "ignored_invalid_upstream=${upstream}"
        fi
    done

    if [[ "${docker_emitted}" != "true" && "${DOCKER_EMBEDDED_DNS_MODE}" != "off" ]] && docker_embedded_generic_upstream_enabled; then
        if ! printf '%s
' "${emitted}" | awk -v u="${DOCKER_EMBEDDED_RESOLVER}" '$0 == u {found=1} END{exit found?0:1}'; then
            printf '%s
' "${DOCKER_EMBEDDED_RESOLVER}"
            docker_emitted="true"
        fi
    fi

    if [[ "${docker_emitted}" == "true" ]]; then
        DOCKER_EMBEDDED_UPSTREAM_STATUS="included-${DOCKER_EMBEDDED_DNS_MODE}"
        append_report "docker_embedded_resolver=included resolver=${DOCKER_EMBEDDED_RESOLVER} mode=${DOCKER_EMBEDDED_DNS_MODE}"
    else
        DOCKER_EMBEDDED_UPSTREAM_STATUS="not-included"
    fi
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
    local live_lines selected_order tmp now upstream score avg min_ms p95 ok fail
    local selected_count selected_epoch previous_selected previous_last_selected previous_success previous_failure
    local ranking_dir fail_epoch

    live_lines="${1:-}"
    selected_order="${2:-}"
    ensure_ranking_file_unlocked || return 0

    ranking_dir="$(dirname "${RANKING_FILE}" 2> /dev/null || printf /tmp)"
    tmp="$(make_temp_file dns-ranking "${ranking_dir}")"
    [[ -n "${tmp}" ]] || return 0
    now="$(now_epoch)"

    if ! printf '%s\n' 'upstream	success_count	failure_count	last_success_epoch	last_failure_epoch	avg_ms	min_ms	p95_ms	rank_score	selected_count	last_selected_epoch' > "${tmp}" 2> /dev/null; then
        rm -f "${tmp}" 2> /dev/null || true
        return 0
    fi

    while IFS=$'	' read -r score avg min_ms p95 ok fail upstream; do
        [[ -n "${upstream}" ]] || continue

        score="$(uint_or_zero "${score}")"
        avg="$(uint_or_zero "${avg}")"
        min_ms="$(uint_or_zero "${min_ms}")"
        p95="$(uint_or_zero "${p95}")"
        ok="$(uint_or_zero "${ok}")"
        fail="$(uint_or_zero "${fail}")"

        previous_selected="$(awk -F'	' -v u="${upstream}" 'NR > 1 && $1 == u {print $10+0; exit}' "${RANKING_FILE}" 2> /dev/null || printf '0')"
        previous_last_selected="$(awk -F'	' -v u="${upstream}" 'NR > 1 && $1 == u {print $11+0; exit}' "${RANKING_FILE}" 2> /dev/null || printf '0')"
        previous_success="$(awk -F'	' -v u="${upstream}" 'NR > 1 && $1 == u {print $2+0; exit}' "${RANKING_FILE}" 2> /dev/null || printf '0')"
        previous_failure="$(awk -F'	' -v u="${upstream}" 'NR > 1 && $1 == u {print $3+0; exit}' "${RANKING_FILE}" 2> /dev/null || printf '0')"

        previous_selected="$(uint_or_zero "${previous_selected}")"
        previous_last_selected="$(uint_or_zero "${previous_last_selected}")"
        previous_success="$(uint_or_zero "${previous_success}")"
        previous_failure="$(uint_or_zero "${previous_failure}")"

        selected_count="${previous_selected}"
        selected_epoch="${previous_last_selected}"
        if printf '%s\n' "${selected_order}" | awk -v u="${upstream}" '$0 == u {found=1} END {exit found ? 0 : 1}'; then
            selected_count=$((selected_count + 1))
            selected_epoch="${now}"
        fi

        fail_epoch="0"
        if ((fail > 0)); then
            fail_epoch="${now}"
        fi

        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "${upstream}" "$((previous_success + ok))" "$((previous_failure + fail))" "${now}" "${fail_epoch}" \
            "${avg}" "${min_ms}" "${p95}" "${score}" "${selected_count}" "${selected_epoch}" >> "${tmp}" 2> /dev/null || true
    done <<< "${live_lines}"

    if mv -f "${tmp}" "${RANKING_FILE}" 2> /dev/null; then
        chmod 0600 "${RANKING_FILE}" 2> /dev/null || true
    else
        rm -f "${tmp}" 2> /dev/null || true
    fi
}

save_ranking_from_live() {
    ensure_parent_dir "${RANKING_LOCK_FILE}"
    if has_cmd flock; then
        (
            if [[ "${RANKING_LOCK_WAIT_SECONDS}" -gt 0 ]]; then
                flock -x -w "${RANKING_LOCK_WAIT_SECONDS}" 9 || exit 98
            else
                flock -x 9 || exit 98
            fi
            save_ranking_from_live_unlocked "$@"
        ) 9> "${RANKING_LOCK_FILE}"
        return $?
    fi
    save_ranking_from_live_unlocked "$@"
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
        if [[ "${ACTION}" == "start" || "${ACTION}" == "restart" || "${ACTION}" == "health" || "${ACTION}" == "status" ]] && [[ "${RANKING_REBENCHMARK_ON_START}" != "true" ]]; then
            need_live="false-static"
        else
            need_live="true"
        fi
    elif ! ranking_is_fresh; then
        need_live="true"
    elif [[ "${RANKING_REBENCHMARK_ON_START}" == "true" && "${age}" -ge "${RANKING_REBENCHMARK_MIN_SECONDS}" ]]; then
        need_live="true"
    fi

    if [[ "${need_live}" == "false-static" ]]; then
        local static_selected
        RANKING_SOURCE="static"
        RANKING_STALE="unknown"
        RANKING_REASON="no-persistent-ranking-live-benchmark-disabled-on-start"
        static_selected="$(valid_upstreams_static)"
        SELECTED_UPSTREAMS="$(printf '%s\n' "${static_selected}" | awk 'NF{printf "%s%s", sep, $0; sep=" "}')"
        UPSTREAM_COUNT="$(printf '%s\n' "${static_selected}" | awk 'NF{c++} END{print c+0}')"
        write_ranking_state
        printf '%s\n' "${static_selected}"
        return 0
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
        if [[ "${DNS_DOMAIN_NEEDED}" == "true" ]]; then
            if docker_embedded_split_dns_enabled && [[ "${DOCKER_EMBEDDED_ROUTE_UNQUALIFIED}" == "true" ]]; then
                append_report "dnsmasq_domain_needed=skipped reason=docker-embedded-unqualified-split"
                append_event "dnsmasq-domain-needed-skipped" "info" "docker-embedded-unqualified-split"
            else
                printf 'domain-needed\n'
            fi
        fi
        printf 'bogus-priv\n'
        if [[ "${STOP_DNS_REBIND}" == "true" ]]; then
            emit_dnsmasq_optional_config_line 'stop-dns-rebind' 'stop-dns-rebind' || true
        fi
        if [[ "${DNS_LOOP_DETECT}" == "true" ]]; then
            emit_dnsmasq_optional_config_line 'dns-loop-detect' 'dns-loop-detect' || true
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
        if is_loopback_address "${DNS_BIND_ADDRESS}"; then
            emit_dnsmasq_optional_config_line 'local-service=host' 'local-service-host' || printf 'local-service\n'
        else
            emit_dnsmasq_optional_config_line 'local-service' 'local-service' || true
        fi
        emit_docker_embedded_split_config_lines || true
        if [[ "${DNS_ALL_SERVERS}" == "true" ]]; then
            emit_dnsmasq_optional_config_line 'all-servers' 'all-servers' || true
        fi
        if [[ "${DNS_STRICT_ORDER}" == "true" ]]; then
            emit_dnsmasq_optional_config_line 'strict-order' 'strict-order' || true
        fi
        if [[ "${DNS_USE_STALE_CACHE}" == "true" ]]; then
            emit_dnsmasq_optional_config_line "use-stale-cache=${DNS_USE_STALE_CACHE_TTL}" 'use-stale-cache' || true
        fi
        if [[ "${DNS_FAST_RETRY}" == "true" ]]; then
            emit_dnsmasq_optional_config_line "fast-dns-retry=${DNS_FAST_RETRY_INITIAL_MS},${DNS_FAST_RETRY_WINDOW_MS}" 'fast-dns-retry' || true
        fi
        if [[ "${LOG_QUERIES}" == "true" ]]; then
            emit_dnsmasq_optional_config_line 'log-queries=extra' 'log-queries-extra' || printf 'log-queries\n'
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

probe_with_drill() {
    local kind host server port out answer_count answers rc
    kind="${1:-local}"
    host="${2:-${PROBE_HOST}}"
    server="${3:-${DNS_BIND_ADDRESS}}"
    port="${4:-${DNS_BIND_PORT}}"
    has_cmd drill || return 1
    out="$(drill -Q -p "${port}" @"${server}" "${host}" A 2> /dev/null || true)"
    answers="$(printf '%s\n' "${out}" | awk '/^[0-9]+(\.[0-9]+){3}$/ {print}' | tr '\n' ' ')"
    answer_count="$(printf '%s\n' "${answers}" | awk '{print NF}')"
    [[ "${answer_count}" =~ ^[0-9]+$ ]] || answer_count=0
    rc=1
    ((answer_count > 0)) && rc=0
    append_metric "${kind}-drill" "${host}" "${server}" "${port}" "${rc}" "${answer_count}" "0" "${answers}"
    if [[ "${rc}" -eq 0 ]]; then
        append_report "probe=ok kind=${kind} tool=drill host=${host} server=${server} port=${port} answers=${answers}"
        return 0
    fi
    append_report "probe=fail kind=${kind} tool=drill host=${host} server=${server} port=${port}"
    return 1
}

probe_with_nslookup() {
    local kind host server port out answer_count answers rc
    kind="${1:-local}"
    host="${2:-${PROBE_HOST}}"
    server="${3:-${DNS_BIND_ADDRESS}}"
    port="${4:-${DNS_BIND_PORT}}"
    has_cmd nslookup || return 1
    out="$(nslookup -timeout="${PROBE_TIMEOUT}" -port="${port}" "${host}" "${server}" 2> /dev/null || true)"
    answers="$(printf '%s\n' "${out}" | awk '/^Address: / {print $2}' | awk '/^[0-9]+(\.[0-9]+){3}$/ {print}' | tr '\n' ' ')"
    answer_count="$(printf '%s\n' "${answers}" | awk '{print NF}')"
    [[ "${answer_count}" =~ ^[0-9]+$ ]] || answer_count=0
    rc=1
    ((answer_count > 0)) && rc=0
    append_metric "${kind}-nslookup" "${host}" "${server}" "${port}" "${rc}" "${answer_count}" "0" "${answers}"
    if [[ "${rc}" -eq 0 ]]; then
        append_report "probe=ok kind=${kind} tool=nslookup host=${host} server=${server} port=${port} answers=${answers}"
        return 0
    fi
    append_report "probe=fail kind=${kind} tool=nslookup host=${host} server=${server} port=${port}"
    return 1
}

local_probe_status_is_proven() {
    [[ "${LOCAL_PROBE_PROVEN:-false}" == "true" ]] || return 1
    case "${LOCAL_PROBE_STATUS:-unknown}" in
        ok | ok-dig | ok-drill | ok-nslookup) return 0 ;;
        *) return 1 ;;
    esac
}

probe_local_dns() {
    LOCAL_PROBE_TOOL="none"
    LOCAL_PROBE_PROVEN="false"
    LOCAL_PROBE_PROOF_REASON="not-probed"

    if has_cmd dig; then
        LOCAL_PROBE_TOOL="dig"
        if probe_with_dig "local" "${PROBE_HOST}" "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
            LOCAL_PROBE_STATUS="ok-dig"
            LOCAL_PROBE_PROVEN="true"
            LOCAL_PROBE_PROOF_REASON="dig-target-server-success"
            return 0
        fi
    fi

    if has_cmd drill; then
        LOCAL_PROBE_TOOL="drill"
        if probe_with_drill "local" "${PROBE_HOST}" "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
            LOCAL_PROBE_STATUS="ok-drill"
            LOCAL_PROBE_PROVEN="true"
            LOCAL_PROBE_PROOF_REASON="drill-target-server-success"
            return 0
        fi
    fi

    if has_cmd nslookup; then
        LOCAL_PROBE_TOOL="nslookup"
        if probe_with_nslookup "local" "${PROBE_HOST}" "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}"; then
            LOCAL_PROBE_STATUS="ok-nslookup"
            LOCAL_PROBE_PROVEN="true"
            LOCAL_PROBE_PROOF_REASON="nslookup-target-server-success"
            return 0
        fi
    fi

    if dnsmasq_is_running && [[ "${ALLOW_PROCESS_ONLY_LOCAL_PROBE}" == "true" ]]; then
        append_report "probe=fallback-process-only rc=0 allowed=true"
        append_metric "fallback-process-only" "${PROBE_HOST}" "process" "" "0" "0" "0" ""
        LOCAL_PROBE_STATUS="ok-process-only"
        LOCAL_PROBE_TOOL="process"
        LOCAL_PROBE_PROVEN="false"
        LOCAL_PROBE_PROOF_REASON="process-only-allowed-but-not-dns-proof"
        return 0
    fi

    if dnsmasq_is_running; then
        append_report "probe=fallback-process-only rc=0 allowed=false proof=failed"
        append_metric "fallback-process-only" "${PROBE_HOST}" "process" "" "0" "0" "0" ""
        LOCAL_PROBE_STATUS="failed-unproven-process-only"
        LOCAL_PROBE_TOOL="${LOCAL_PROBE_TOOL:-process}"
        LOCAL_PROBE_PROVEN="false"
        LOCAL_PROBE_PROOF_REASON="no-targeted-dns-client-probe-available"
        return 1
    fi

    append_report "probe=fallback-process-only rc=1"
    append_metric "fallback-process-only" "${PROBE_HOST}" "process" "" "1" "0" "0" ""
    LOCAL_PROBE_STATUS="failed"
    LOCAL_PROBE_PROOF_REASON="dnsmasq-not-running-or-probe-failed"
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
    comm="$(awk 'NR == 1 {print; exit}' "/proc/${pid}/comm" 2> /dev/null || true)"
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
    socket_owner_lines \
        | awk '
            {
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
        local existing_pid
        existing_pid="$(read_dnsmasq_pid)"
        if [[ -z "${existing_pid}" || ! "${existing_pid}" =~ ^[0-9]+$ || ! -d "/proc/${existing_pid}" ]]; then
            remove_file_privileged "${DNSMASQ_PID_FILE}" || true
        fi
    fi

    if [[ -e "${DNSMASQ_LOG_FILE}" && ! -w "${DNSMASQ_LOG_FILE}" ]]; then
        remove_file_privileged "${DNSMASQ_LOG_FILE}" || true
    fi

    truncate_file_privileged "${DNSMASQ_LOG_FILE}" || true
    chmod 0644 "${DNSMASQ_LOG_FILE}" 2> /dev/null || safe_sudo chmod 0644 "${DNSMASQ_LOG_FILE}" 2> /dev/null || true
    return 0
}

start_dnsmasq_process_as_user() {
    # Close FD 9 so daemonized dnsmasq never inherits the manager flock.
    dnsmasq --conf-file="${DNSMASQ_CONF}" 9>&- > /dev/null 2> /dev/null
}

start_dnsmasq_process_as_root() {
    # Close FD 9 so daemonized dnsmasq never inherits the manager flock.
    safe_sudo dnsmasq --conf-file="${DNSMASQ_CONF}" 9>&- > /dev/null 2> /dev/null
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
        {
            ss -H -lnup 2> /dev/null || true
            ss -H -lntp 2> /dev/null || true
        } | awk -v p=":${DNS_BIND_PORT}" '$0 ~ p {print "ss: "$0}' >> "${REPORT_FILE}" 2> /dev/null || true
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
        log_info "DNS cache local desligado por modo=off."
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

    if [[ "${WRITE_RESOLV_CONF}" == "true" ]] && ! can_write_resolv_conf_noninteractive; then
        log_warn "/etc/resolv.conf não parece gravável sem sudo não-interativo; DNS cache não será aplicado ao resolver do sistema."
        append_report "result=resolv-conf-write-privilege-unavailable status=${RESOLV_CONF_WRITE_PRIVILEGE_STATUS}"
        if [[ "${DNS_MODE}" == "auto" ]]; then
            write_status "off"
            write_summary "off" "resolv-conf-write-privilege-unavailable-auto"
            return 0
        fi
        write_status "degraded"
        write_summary "degraded" "resolv-conf-write-privilege-unavailable"
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

    if [[ -s "${DNSMASQ_PID_FILE}" ]]; then
        local existing_pid
        existing_pid="$(read_dnsmasq_pid)"
        if [[ -n "${existing_pid}" && ! -d "/proc/${existing_pid}" ]]; then
            append_report "stale_pidfile_removed_before_start pid=${existing_pid}"
            remove_file_privileged "${DNSMASQ_PID_FILE}" || true
        fi
    fi

    if dnsmasq_is_running; then
        log_info "dnsmasq já está em execução para ${DNSMASQ_CONF}; validando antes de reutilizar."
        if [[ -r "${DNSMASQ_CONF}" ]]; then
            SELECTED_UPSTREAMS="$(awk -F= '$1=="server" {printf "%s%s", sep, $2; sep=" "}' "${DNSMASQ_CONF}" 2> /dev/null || true)"
            UPSTREAM_COUNT="$(awk -F= '$1=="server" {c++} END{print c+0}' "${DNSMASQ_CONF}" 2> /dev/null || printf '0')"
        fi
        if probe_local_dns; then
            collect_runtime_health
            append_report "dnsmasq=reused-running probe=ok process_status=${DNSMASQ_PROCESS_STATUS}"
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

    resolv_conf_state_refresh
    if [[ -s "${RESOLV_BACKUP_FILE}" ]]; then
        if resolv_backup_meta_is_current || [[ "${ALLOW_STALE_RESOLV_BACKUP_RESTORE}" == "true" ]]; then
            if safe_sudo tee /etc/resolv.conf < "${RESOLV_BACKUP_FILE}" > /dev/null 2>&1; then
                log_info "/etc/resolv.conf restaurado a partir de ${RESOLV_BACKUP_FILE}."
                append_report "resolv_conf=restored backup=${RESOLV_BACKUP_FILE} backup_trust=${RESOLV_BACKUP_TRUST_STATUS:-unknown}"
                append_event "resolv-conf-restored" "info" "backup=${RESOLV_BACKUP_FILE}"
                RESOLV_CONF_STATUS="restored"
                return 0
            fi
        else
            RESOLV_BACKUP_TRUST_STATUS="stale-or-missing-meta"
            append_report "resolv_conf_backup=not-restored reason=stale-or-missing-meta backup=${RESOLV_BACKUP_FILE} meta=${RESOLV_BACKUP_META_FILE}"
            append_event "resolv-backup-rejected" "warn" "stale-or-missing-meta"
        fi
    fi

    local tmp upstream count search_line
    tmp="$(make_temp_file resolv-stop-fallback /tmp)"
    [[ -n "${tmp}" ]] || return 1
    count=0
    search_line="$(safe_resolv_search_line_from_current)"
    {
        printf '# Generated fallback by %s v%s at %s
' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
        if [[ -n "${search_line}" ]]; then
            printf '%s
' "${search_line}"
        fi
        for upstream in ${DNS_UPSTREAMS}; do
            if is_valid_nameserver "${upstream}" && ! is_loopback_address "${upstream}"; then
                printf 'nameserver %s
' "${upstream}"
                count=$((count + 1))
                [[ "${count}" -ge 3 ]] && break
            fi
        done
        if ((count == 0)) && docker_embedded_resolver_should_be_considered; then
            printf 'nameserver %s
' "${DOCKER_EMBEDDED_RESOLVER}"
            count=1
        fi
        printf 'options %s
' "${DNS_OPTIONS}"
    } > "${tmp}" 2> /dev/null || true

    if [[ "${count}" -gt 0 ]] && safe_sudo tee /etc/resolv.conf < "${tmp}" > /dev/null 2>&1; then
        rm -f "${tmp}" 2> /dev/null || true
        log_info "/etc/resolv.conf restaurado para fallback upstream."
        append_report "resolv_conf=fallback-restored"
        append_event "resolv-conf-fallback-restored" "warn" "count=${count}"
        RESOLV_CONF_STATUS="fallback-restored"
        return 0
    fi

    rm -f "${tmp}" 2> /dev/null || true
    log_warn "não foi possível restaurar /etc/resolv.conf."
    append_report "resolv_conf=restore-failed"
    append_event "resolv-conf-restore-failed" "error" "backup=${RESOLV_BACKUP_FILE}"
    RESOLV_CONF_STATUS="restore-failed"
    return 1
}

restore_resolv_conf_after_failure() {
    local why
    why="${1:-runtime-failure}"
    [[ "${RESTORE_RESOLV_CONF_ON_FAILURE}" == "true" ]] || return 0
    if resolv_conf_is_managed; then
        append_report "resolv_conf=restore-after-failure reason=${why}"
        restore_or_fallback_resolv_conf || true
    fi
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

    while IFS= read -r pid; do
        [[ -n "${pid}" ]] || continue
        terminate_dnsmasq_pid "${pid}" "managed-cmdline" || stop_rc=1
    done < <(managed_dnsmasq_pids_by_cmdline)

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
    grep -F -q "${RESOLV_MANAGED_MARKER}" /etc/resolv.conf 2> /dev/null
}

resolv_backup_meta_is_current() {
    local fp meta_fp
    [[ -s "${RESOLV_BACKUP_FILE}" && -r "${RESOLV_BACKUP_META_FILE}" ]] || return 1
    fp="$(container_fingerprint)"
    meta_fp="$(summary_value_from_file "${RESOLV_BACKUP_META_FILE}" container_fingerprint)"
    [[ -n "${meta_fp}" && "${meta_fp}" == "${fp}" ]] || return 1
    RESOLV_BACKUP_TRUST_STATUS="current"
    return 0
}

write_resolv_backup_meta() {
    {
        printf 'container_fingerprint=%s\n' "$(container_fingerprint)"
        printf 'created_at=%s\n' "$(ts)"
        printf 'backup_file=%s\n' "${RESOLV_BACKUP_FILE}"
        printf 'source_nameservers=%s\n' "${RESOLV_CONF_NAMESERVERS:-unknown}"
        printf 'source_first_nameserver=%s\n' "${RESOLV_CONF_FIRST_NAMESERVER:-unknown}"
        printf 'source_search_line=%s\n' "${RESOLV_CONF_SEARCH_LINE:-none}"
        printf 'source_domain_line=%s\n' "${RESOLV_CONF_DOMAIN_LINE:-none}"
        printf 'source_inode=%s\n' "${RESOLV_CONF_INODE:-unknown}"
        printf 'source_mtime_epoch=%s\n' "${RESOLV_CONF_MTIME_EPOCH:-0}"
        printf 'source_sha256=%s\n' "${RESOLV_CONF_SHA256:-unknown}"
    } | safe_write_file "${RESOLV_BACKUP_META_FILE}" 0600 || true
}

backup_resolv_conf_once() {
    [[ -r /etc/resolv.conf ]] || return 0

    resolv_conf_state_refresh

    if resolv_conf_is_managed; then
        append_report "resolv_conf_backup=preserved existing=${RESOLV_BACKUP_FILE} reason=current-managed"
        return 0
    fi

    if [[ -s "${RESOLV_BACKUP_FILE}" ]] && ! grep -F -q "${RESOLV_MANAGED_MARKER}" "${RESOLV_BACKUP_FILE}" 2> /dev/null; then
        if resolv_backup_meta_is_current; then
            append_report "resolv_conf_backup=preserved existing=${RESOLV_BACKUP_FILE} trust=current"
            return 0
        fi
        append_report "resolv_conf_backup=refresh reason=stale-or-missing-meta existing=${RESOLV_BACKUP_FILE}"
    fi

    cp /etc/resolv.conf "${RESOLV_BACKUP_FILE}" 2> /dev/null || return 0
    chmod 0600 "${RESOLV_BACKUP_FILE}" 2> /dev/null || true
    write_resolv_backup_meta
    RESOLV_BACKUP_TRUST_STATUS="created-current"
    append_report "resolv_conf_backup=${RESOLV_BACKUP_FILE} meta=${RESOLV_BACKUP_META_FILE}"
    return 0
}

verify_resolv_conf_points_to_cache() {
    awk -v ns="${DNS_BIND_ADDRESS}" '
        $1 == "nameserver" && $2 == ns { found=1 }
        END { exit found ? 0 : 1 }
    ' /etc/resolv.conf 2> /dev/null
}

can_write_resolv_conf_noninteractive() {
    if [[ "${WRITE_RESOLV_CONF}" != "true" ]]; then
        RESOLV_CONF_WRITE_PRIVILEGE_STATUS="disabled"
        return 0
    fi
    if [[ -w /etc/resolv.conf ]]; then
        RESOLV_CONF_WRITE_PRIVILEGE_STATUS="direct-writable"
        return 0
    fi
    if [[ "$(id -u 2> /dev/null || echo 1)" == "0" ]]; then
        RESOLV_CONF_WRITE_PRIVILEGE_STATUS="root"
        return 0
    fi
    if has_cmd sudo && sudo -n true 2> /dev/null; then
        RESOLV_CONF_WRITE_PRIVILEGE_STATUS="sudo-noninteractive"
        return 0
    fi
    RESOLV_CONF_WRITE_PRIVILEGE_STATUS="unavailable"
    return 1
}

write_resolv_conf() {
    local tmp search_line
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

    if ! can_write_resolv_conf_noninteractive; then
        log_warn "não escrevendo /etc/resolv.conf: sem permissão direta ou sudo não-interativo."
        RESOLV_CONF_STATUS="write-privilege-unavailable"
        append_event "resolv-conf-write-privilege-unavailable" "error" "target=/etc/resolv.conf"
        return 1
    fi

    backup_resolv_conf_once || true

    search_line="$(safe_resolv_search_line_from_current)"
    tmp="$(make_temp_file resolv.conf /tmp)"
    [[ -n "${tmp}" ]] || return 1
    {
        printf '# %s by %s v%s at %s
' "${RESOLV_MANAGED_MARKER}" "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
        printf '# source-nameservers: %s
' "${RESOLV_CONF_NAMESERVERS:-unknown}"
        if [[ -n "${search_line}" ]]; then
            printf '%s
' "${search_line}"
        fi
        printf 'nameserver %s
' "${DNS_BIND_ADDRESS}"
        printf 'options %s
' "${DNS_OPTIONS}"
    } > "${tmp}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }

    if ! safe_sudo tee /etc/resolv.conf < "${tmp}" > /dev/null 2>&1; then
        rm -f "${tmp}" 2> /dev/null || true
        log_warn "falha ao escrever /etc/resolv.conf via tee."
        RESOLV_CONF_STATUS="write-failed"
        append_event "resolv-conf-write-failed" "error" "target=/etc/resolv.conf"
        return 1
    fi

    rm -f "${tmp}" 2> /dev/null || true

    if ! verify_resolv_conf_points_to_cache; then
        log_warn "/etc/resolv.conf foi escrito, mas não aponta para ${DNS_BIND_ADDRESS}."
        append_report "resolv_conf=verify-failed expected_nameserver=${DNS_BIND_ADDRESS}"
        append_event "resolv-conf-verify-failed" "error" "expected=${DNS_BIND_ADDRESS}"
        RESOLV_CONF_STATUS="verify-failed"
        return 1
    fi

    append_report "resolv_conf=updated nameserver=${DNS_BIND_ADDRESS} options=${DNS_OPTIONS} preserved_search=$(printf '%s' "${search_line:-none}" | tr ' ' '_')"
    append_event "resolv-conf-updated" "info" "nameserver=${DNS_BIND_ADDRESS}"
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
    if [[ "${PREVIOUS_SUMMARY_STALE}" == "true" ]]; then
        log_warn "previous summary stale: ${PREVIOUS_SUMMARY_STALE_REASON}; avaliando runtime atual mesmo assim."
    fi
    if [[ "${STATUS_STALE}" == "true" ]]; then
        log_warn "runtime/status contradiction: ${STATUS_STALE_REASON}."
        write_status "stale"
        write_summary "stale" "${STATUS_STALE_REASON}"
        return 1
    fi
    if managed_dnsmasq_runtime_running; then
        log_ok "dnsmasq managed running; process_status=${DNSMASQ_PROCESS_STATUS}; port=${DNSMASQ_PORT_STATUS}; pidfile=${DNSMASQ_PIDFILE_STATUS}; resolv_conf=${RESOLV_CONF_HEALTH}; drift=${RESOLV_CONF_DRIFT}; runtime_effective=${RUNTIME_EFFECTIVE}; resolver_effective=${RESOLVER_EFFECTIVE}"
        write_status "ok"
        write_summary "ok" "dnsmasq-managed-running"
        return 0
    fi
    log_warn "dnsmasq gerenciado não está rodando. process_status=${DNSMASQ_PROCESS_STATUS}; port=${DNSMASQ_PORT_STATUS}; pidfile=${DNSMASQ_PIDFILE_STATUS}; resolv_conf=${RESOLV_CONF_HEALTH}; drift=${RESOLV_CONF_DRIFT}"
    write_status "stopped"
    write_summary "stopped" "dnsmasq-not-managed-running"
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
        write_status "degraded"
        write_action_summary "degraded" "benchmark-no-functional-upstream" "benchmark"
        if [[ "${UPDATE_RUNTIME_SUMMARY_FOR_ACTIONS}" == "true" ]]; then
            write_summary "degraded" "benchmark-no-functional-upstream"
        fi
        return 1
    fi
    SELECTED_UPSTREAMS="$(printf '%s' "${selected}" | tr '
' ' ' | sed 's/[[:space:]]*$//')"
    UPSTREAM_COUNT="$(printf '%s
' "${selected}" | awk 'NF{c++} END{print c+0}')"
    append_report "benchmark_ranked_upstreams=${SELECTED_UPSTREAMS} source=${RANKING_SOURCE} reason=${RANKING_REASON}"
    append_event "dns-benchmark" "info" "source=${RANKING_SOURCE};upstreams=${SELECTED_UPSTREAMS}"
    log_ok "benchmark upstreams: ${SELECTED_UPSTREAMS}"
    write_status "benchmark-ok"
    write_action_summary "ok" "benchmark-ok" "benchmark"
    if [[ "${UPDATE_RUNTIME_SUMMARY_FOR_ACTIONS}" == "true" ]]; then
        write_summary "ok" "benchmark-ok"
    fi
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
    if [[ "${WRITE_RESOLV_CONF}" == "true" ]] && ! can_write_resolv_conf_noninteractive; then
        log_warn "doctor: /etc/resolv.conf não parece gravável sem interação; status=${RESOLV_CONF_WRITE_PRIVILEGE_STATUS}."
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
    if docker_embedded_resolver_should_be_considered; then
        log_ok "doctor: Docker embedded DNS elegível: ${DOCKER_EMBEDDED_RESOLVER} modo=${DOCKER_EMBEDDED_DNS_MODE}."
    else
        log_info "doctor: Docker embedded DNS não será incluído como upstream."
    fi
    if [[ "${PRESERVE_RESOLV_SEARCH}" == "true" ]]; then
        log_info "doctor: preservação de search/domain resolv.conf habilitada; linha atual=${RESOLV_CONF_SEARCH_LINE}/${RESOLV_CONF_DOMAIN_LINE}."
    fi
    log_info "doctor: dnsmasq_process_status=${DNSMASQ_PROCESS_STATUS}; dnsmasq_port_status=${DNSMASQ_PORT_STATUS}; pidfile=${DNSMASQ_PIDFILE_STATUS}; socket_owner_visibility=${DNSMASQ_SOCKET_OWNER_VISIBILITY}; resolv_conf_health=${RESOLV_CONF_HEALTH}; drift=${RESOLV_CONF_DRIFT}/${RESOLV_CONF_DRIFT_REASON}; status_stale=${STATUS_STALE}."
    if [[ "${DNS_UPSTREAM_SELECTION}" == "ranked" ]]; then
        if [[ -s "${RANKING_FILE}" ]]; then
            log_ok "doctor: ranking persistente detectado: ${RANKING_FILE}"
        else
            log_warn "doctor: ranking persistente ainda ausente; será criado no próximo benchmark/start ranked."
        fi
    fi
    if [[ "${rc}" -eq 0 ]]; then
        write_status "doctor-ok"
        write_action_summary "ok" "doctor" "doctor"
        if [[ "${UPDATE_RUNTIME_SUMMARY_FOR_ACTIONS}" == "true" ]]; then
            write_summary "ok" "doctor"
        fi
    else
        write_status "doctor-degraded"
        write_action_summary "degraded" "doctor" "doctor"
        if [[ "${UPDATE_RUNTIME_SUMMARY_FOR_ACTIONS}" == "true" ]]; then
            write_summary "degraded" "doctor"
        fi
    fi
    return "${rc}"
}

health_action() {
    local rc
    rc=0
    if [[ "${DNS_MODE}" == "off" ]]; then
        write_status "off"
        write_summary "off" "mode-off"
        log_info "health: DNS cache mode off."
        return 0
    fi
    collect_runtime_health
    if ! managed_dnsmasq_runtime_running; then
        rc=1
    fi
    if [[ "${WRITE_RESOLV_CONF}" == "true" && "${RESOLV_CONF_POINTS_TO_CACHE}" != "true" ]]; then
        rc=1
    fi
    if [[ "${rc}" -eq 0 ]]; then
        probe_local_dns || rc=1
        probe_system_resolver || rc=1
        collect_runtime_health
    fi
    if [[ "${rc}" -eq 0 && "${REQUIRE_PROVEN_LOCAL_PROBE_FOR_RESOLV_CONF}" == "true" ]] && ! local_probe_status_is_proven; then
        rc=1
    fi
    if [[ "${rc}" -eq 0 && "${RUNTIME_EFFECTIVE}" != "true" ]]; then
        rc=1
    fi
    if [[ "${rc}" -eq 0 && "${WRITE_RESOLV_CONF}" == "true" && "${RESOLVER_EFFECTIVE}" != "true" ]]; then
        rc=1
    fi
    if [[ "${rc}" -eq 0 && "${WRITE_RESOLV_CONF}" == "true" && "${RESOLV_CONF_DRIFT}" == "true" ]]; then
        rc=1
    fi
    if [[ "${rc}" -eq 0 ]]; then
        write_status "ok"
        write_summary "ok" "health-ok"
        log_ok "health OK: dnsmasq=${DNSMASQ_PROCESS_STATUS}; port=${DNSMASQ_PORT_STATUS}; pidfile=${DNSMASQ_PIDFILE_STATUS}; resolv_conf=${RESOLV_CONF_HEALTH}; drift=${RESOLV_CONF_DRIFT}; runtime=${RUNTIME_EFFECTIVE}; resolver=${RESOLVER_EFFECTIVE}; local_probe=${LOCAL_PROBE_STATUS}; system_probe=${SYSTEM_PROBE_STATUS}"
    else
        write_status "degraded"
        write_summary "degraded" "health-degraded"
        log_warn "health degraded: dnsmasq=${DNSMASQ_PROCESS_STATUS}; port=${DNSMASQ_PORT_STATUS}; pidfile=${DNSMASQ_PIDFILE_STATUS}; resolv_conf=${RESOLV_CONF_HEALTH}; drift=${RESOLV_CONF_DRIFT}/${RESOLV_CONF_DRIFT_REASON}; runtime=${RUNTIME_EFFECTIVE}; resolver=${RESOLVER_EFFECTIVE}; local_probe=${LOCAL_PROBE_STATUS}; system_probe=${SYSTEM_PROBE_STATUS}"
    fi
    return "${rc}"
}

warmup_dns_cache() {
    local host rr count ok_count fail_count
    [[ "${DNS_WARMUP}" == "true" ]] || {
        WARMUP_STATUS="disabled"
        return 0
    }
    has_cmd dig || {
        WARMUP_STATUS="skipped-no-dig"
        return 0
    }
    count=0
    ok_count=0
    fail_count=0
    for host in ${DNS_WARMUP_HOSTS}; do
        is_safe_hostname "${host}" || continue
        count=$((count + 1))
        for rr in ${DNS_WARMUP_RECORD_TYPES}; do
            case "${rr}" in A | AAAA) : ;; *) continue ;; esac
            if dig +time="${PROBE_TIMEOUT}" +tries=1 @"${DNS_BIND_ADDRESS}" -p "${DNS_BIND_PORT}" "${host}" "${rr}" +short > /dev/null 2>&1; then
                append_metric "warmup-${rr}" "${host}" "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}" "0" "1" "0" ""
                ok_count=$((ok_count + 1))
            else
                append_metric "warmup-${rr}" "${host}" "${DNS_BIND_ADDRESS}" "${DNS_BIND_PORT}" "1" "0" "0" ""
                fail_count=$((fail_count + 1))
            fi
        done
        [[ "${count}" -ge "${DNS_WARMUP_MAX_HOSTS}" ]] && break
    done
    WARMUP_HOSTS_COUNT="${count}"
    WARMUP_OK_COUNT="${ok_count}"
    WARMUP_FAILED_COUNT="${fail_count}"
    if ((count == 0)); then
        WARMUP_STATUS="skipped-no-valid-hosts"
    elif ((ok_count > 0 && fail_count == 0)); then
        WARMUP_STATUS="ok"
    elif ((ok_count > 0)); then
        WARMUP_STATUS="partial"
    else
        WARMUP_STATUS="failed"
    fi
    append_report "dns_warmup status=${WARMUP_STATUS} hosts=${WARMUP_HOSTS_COUNT} ok=${WARMUP_OK_COUNT} failed=${WARMUP_FAILED_COUNT}"
    append_event "dns-warmup" "info" "status=${WARMUP_STATUS};hosts=${WARMUP_HOSTS_COUNT};ok=${WARMUP_OK_COUNT};failed=${WARMUP_FAILED_COUNT}"
    return 0
}

start_flow() {
    local current_status
    start_dnsmasq || return 1
    current_status="$(read_first_line "${STATUS_FILE}" "")"
    if [[ "${DNS_MODE}" == "off" || "${current_status}" == "off" ]]; then return 0; fi

    collect_runtime_health
    if ! managed_dnsmasq_runtime_running; then
        write_status "degraded"
        append_report "result=dnsmasq-not-managed-running-before-resolv-conf process_status=${DNSMASQ_PROCESS_STATUS} port_status=${DNSMASQ_PORT_STATUS}"
        restore_resolv_conf_after_failure "dnsmasq-not-managed-running-before-resolv-conf"
        write_summary "degraded" "dnsmasq-not-managed-running-before-resolv-conf"
        return 1
    fi

    if ! probe_local_dns; then
        if repair_after_local_probe_failure; then
            append_report "probe_local_after_repair=ok"
            collect_runtime_health
            if ! managed_dnsmasq_runtime_running; then
                write_status "degraded"
                append_report "result=repair-did-not-leave-managed-dnsmasq-running process_status=${DNSMASQ_PROCESS_STATUS} port_status=${DNSMASQ_PORT_STATUS}"
                restore_resolv_conf_after_failure "repair-did-not-leave-managed-dnsmasq-running"
                write_summary "degraded" "repair-did-not-leave-managed-dnsmasq-running"
                return 1
            fi
        else
            restore_resolv_conf_after_failure "local-probe-failed"
            write_status "degraded"
            append_report "result=probe-local-failed proof=${LOCAL_PROBE_PROVEN} reason=${LOCAL_PROBE_PROOF_REASON}"
            write_summary "degraded" "probe-local-failed"
            return 1
        fi
    fi

    if [[ "${REQUIRE_PROVEN_LOCAL_PROBE_FOR_RESOLV_CONF}" == "true" ]] && ! local_probe_status_is_proven; then
        write_status "degraded"
        append_report "result=local-probe-not-proven-before-resolv-conf status=${LOCAL_PROBE_STATUS} tool=${LOCAL_PROBE_TOOL} reason=${LOCAL_PROBE_PROOF_REASON}"
        append_event "local-probe-not-proven" "error" "status=${LOCAL_PROBE_STATUS};tool=${LOCAL_PROBE_TOOL};reason=${LOCAL_PROBE_PROOF_REASON}"
        restore_resolv_conf_after_failure "local-probe-not-proven-before-resolv-conf"
        write_summary "degraded" "local-probe-not-proven-before-resolv-conf"
        return 1
    fi

    write_resolv_conf || {
        write_status "degraded"
        append_report "result=resolv-conf-failed"
        restore_resolv_conf_after_failure "resolv-conf-failed"
        write_summary "degraded" "resolv-conf-failed"
        return 1
    }

    probe_system_resolver || {
        write_status "degraded"
        append_report "result=system-resolver-probe-failed"
        restore_resolv_conf_after_failure "system-resolver-probe-failed"
        write_summary "degraded" "system-resolver-probe-failed"
        return 1
    }

    warmup_dns_cache || true
    collect_runtime_health
    write_status "ok"
    append_report "result=ok runtime_effective=${RUNTIME_EFFECTIVE} resolver_effective=${RESOLVER_EFFECTIVE}"
    write_summary "ok" "start-flow-ok"
    log_ok "Local DNS cache aplicado e validado."
    return 0
}

main_unlocked() {
    local probe_rc stop_rc
    if [[ "${ACTION}" == "status" ]]; then
        ensure_parent_dir "${REPORT_FILE}"
        ensure_parent_dir "${METRICS_FILE}"
        append_report "status_action_invoked timestamp=$(ts)"
    else
        write_report_header
        write_metrics_header
        ensure_events_header
        append_event "action-start" "info" "action=${ACTION};mode=${DNS_MODE}"
        write_status "running"
    fi
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
            stop_rc=$?
            if [[ "${stop_rc}" -eq 0 ]]; then
                write_status "stopped"
                append_report "result=stopped"
                write_summary "stopped" "stop"
            else
                write_status "degraded"
                append_report "result=stop-degraded rc=${stop_rc}"
                write_summary "degraded" "stop-degraded"
            fi
            return "${stop_rc}"
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
                write_status "ok"
                write_summary "ok" "probe"
            else
                write_status "degraded"
                write_summary "degraded" "probe"
            fi
            return "${probe_rc}"
            ;;
    esac

    start_flow
    return $?
}

lock_diagnostics() {
    local lock_file out
    lock_file="${1:-${LOCK_FILE}}"
    out=""
    if has_cmd lsof; then
        out="$(lsof "${lock_file}" 2> /dev/null | sed -n '1,20p' 2> /dev/null || true)"
    fi
    if [[ -z "${out}" ]] && has_cmd fuser; then
        out="$(fuser -v "${lock_file}" 2>&1 | sed -n '1,20p' 2> /dev/null || true)"
    fi
    [[ -n "${out}" ]] || out="no-holder-detected-or-diagnostic-tool-missing"
    printf '%s' "${out}" | tr '\r\n\t' '   ' | awk '{gsub(/[[:cntrl:]]/, ""); print; exit}'
}

effective_lock_file() {
    local configured dir uid fallback
    configured="${LOCK_FILE}"
    ensure_parent_dir "${configured}"
    if { : >> "${configured}"; } 2> /dev/null; then
        printf '%s' "${configured}"
        return 0
    fi
    uid="$(id -u 2> /dev/null || printf 'unknown')"
    fallback="/tmp/local-dns-cache.${uid}.lock"
    dir="$(dirname "${fallback}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${dir}" 2> /dev/null || true
    printf '%s' "${fallback}"
}

write_lock_failure_artifacts() {
    local lock_file diagnostics
    lock_file="${1:-${LOCK_FILE}}"
    diagnostics="$(lock_diagnostics "${lock_file}")"
    write_status "lock-failed"
    append_report "lock=failed lock_file=${lock_file} wait_seconds=${LOCK_WAIT_SECONDS} diagnostics=${diagnostics}"
    {
        printf 'status=lock-failed\n'
        printf 'reason=lock-timeout\n'
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'script_version=%s\n' "${SCRIPT_VERSION}"
        printf 'action=%s\n' "${ACTION}"
        printf 'mode=%s\n' "${DNS_MODE}"
        printf 'lock_file=%s\n' "${lock_file}"
        printf 'configured_lock_file=%s\n' "${LOCK_FILE}"
        printf 'lock_wait_seconds=%s\n' "${LOCK_WAIT_SECONDS}"
        printf 'lock_diagnostics=%s\n' "${diagnostics}"
        printf 'completed_at=%s\n' "$(ts)"
    } | safe_write_file "${SUMMARY_FILE}" 0644 || true
}

main() {
    local rc lock_file
    mkdir -p "${RUNTIME_DIR}" 2> /dev/null || true
    if has_cmd flock; then
        lock_file="$(effective_lock_file)"
        (
            if [[ "${LOCK_WAIT_SECONDS}" -gt 0 ]]; then
                flock -w "${LOCK_WAIT_SECONDS}" -x 9 || exit 98
            else
                flock -x 9 || exit 98
            fi
            main_unlocked
        ) 9> "${lock_file}"
        rc=$?
        if [[ "${rc}" -eq 98 ]]; then
            write_lock_failure_artifacts "${lock_file}"
        fi
        return "${rc}"
    fi
    main_unlocked
}

main "$@"
exit $?
