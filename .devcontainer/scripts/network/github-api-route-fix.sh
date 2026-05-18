#!/usr/bin/env bash
# =============================================================================
# github-api-route-fix.sh — Smart GitHub API Route Selector
# Version: v1.8.6
#
# Purpose:
#   Runtime-only network resilience helper for DevContainers. Intended to be
#   invoked by .devcontainer/scripts/post-start.sh.
#
# Contract:
#   - Does not start services.
#   - Does not mutate Docker/DevContainer structure.
#   - Performs only bounded, reversible runtime-network mutation:
#       * a managed /etc/hosts block for api.github.com, after semantic HTTPS
#         validation of the chosen route.
#   - Preserves Docker-managed /etc/hosts inode by writing through tee; never
#     replaces /etc/hosts with mv/cp.
#   - Exits 0 only when it can prove a functional route by one of these paths:
#       * current direct route is valid and kept;
#       * proxy-aware route is valid and proxy mode allows it;
#       * validated direct candidate was applied and verified.
#   - Exits non-zero when it cannot prove a functional GitHub API route.
#
# Design:
#   - DNS answers, cache entries, /etc/hosts entries and seed IPs are untrusted.
#   - Candidates are validated via HTTPS + SNI + TLS verification + semantic
#     REST API response checks.
#   - Prefer stability: keep current route unless a candidate is materially
#     better or current route is broken.
#   - Use flock when available for cache and hosts writes.
#   - Use mktemp-only temp files; no predictable write fallbacks.
#   - IPv6 is opt-in and rejects IPv4-mapped IPv6 (::ffff:x.y.z.w) so a broken
#     IPv4 route cannot masquerade as an IPv6 candidate.
#   - Persistent candidate cache is treated as signal, not authority.
#     v1.8.0 added bounded recent-failure penalties, per-IP cooldown,
#     gradual recovery and p95 historical latency scoring.
#     v1.8.1 added ShellCheck-oriented cleanup, safer tempfile handling,
#     mktemp-only /etc/hosts backups, optional GitHub /meta candidate discovery,
#     and stronger cache/write hardening.
#     v1.8.2 adds explicit API functionality profile checks (core/copilot/full),
#     API-version configurability, redirect-following probes, richer capability
#     summary/metrics, safer /meta candidate sampling and stronger ShellCheck-
#     oriented cleanup.
#     v1.8.3 adds a long-running benchmark mode with p50/p95/p99/fail-rate
#     aggregation, non-mutating recommendation output, benchmark cache updates
#     and boot-safe policy artifacts for future post-start consumption.
#     v1.8.4 removes a ShellCheck SC2034 benchmark local, makes /meta
#     discovery source-aware and less noisy, prioritizes DNS/current observed
#     candidates over coarse /meta CIDR samples, enriches status/summary with
#     benchmark artifacts, and hardens benchmark recommendation generation.
#     v1.8.5 fixes benchmark recommendation semantics, separates transport
#     reachability from strict root API shape failures, treats GitHub REST
#     403/429 rate-limit/forbidden responses as degraded-but-reachable signals
#     where safe, and prevents cooldown/policy skips from polluting fail-rate.
#     v1.8.6 extends degraded-but-reachable handling to candidate routes,
#     prevents benchmark recommendations from proposing an override to the
#     current IP, adds a passive doctor action, and hardens route/status
#     observability without expanding mutation scope.
#   - Emits report, status, summary and candidate metrics files for post-start and
#     post-attach diagnostics, including structured decision reasons.
#   - Fail-safe shell posture: no inherited traps, no set -e/u/pipefail.
# =============================================================================

set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

# -----------------------------------------------------------------------------
# CLI read-only helpers / positional action compatibility
# -----------------------------------------------------------------------------
CLI_ACTION=""
case "${1:-}" in
    --version)
        printf '%s v%s
' 'github-api-route-fix.sh' '1.8.6'
        exit 0
        ;;
    --help)
        cat << 'USAGE'
github-api-route-fix.sh [--help] [--version] [start|probe|status|clear-cache|benchmark|doctor]

Environment-driven actions:
  DEVCONTAINER_GITHUB_API_ROUTE_ACTION=start|probe|status|clear-cache|benchmark|doctor

The optional positional action is accepted for manual use. Environment variables
continue to take precedence so lifecycle hooks remain deterministic.
USAGE
        exit 0
        ;;
    start | probe | status | clear-cache | benchmark | doctor)
        CLI_ACTION="$1"
        shift || true
        ;;
esac

# -----------------------------------------------------------------------------
# Constants / sanitized config
# -----------------------------------------------------------------------------
readonly SCRIPT_NAME="github-api-route-fix.sh"
readonly SCRIPT_VERSION="1.8.6"

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

readonly GITHUB_API_HOST="${DEVCONTAINER_GITHUB_API_HOST:-api.github.com}"
ALLOW_CUSTOM_HOST="$(cfg_bool "${DEVCONTAINER_GITHUB_API_ALLOW_CUSTOM_HOST:-false}" false)"
readonly ALLOW_CUSTOM_HOST

ACTION="${DEVCONTAINER_GITHUB_API_ROUTE_ACTION:-${DEVCONTAINER_GITHUB_API_ACTION:-${CLI_ACTION:-start}}}"
case "${ACTION}" in
    start | probe | status | clear-cache | benchmark | doctor) : ;;
    *) ACTION="start" ;;
esac
readonly ACTION

readonly GITHUB_ROUTE_REPORT_FILE="${DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE:-/tmp/devcontainer-github-api-route.report}"
readonly GITHUB_ROUTE_STATUS_FILE="${DEVCONTAINER_GITHUB_ROUTE_STATUS_FILE:-/tmp/devcontainer-github-api-route.status}"
readonly GITHUB_ROUTE_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.summary}"
readonly GITHUB_ROUTE_METRICS_FILE="${DEVCONTAINER_GITHUB_ROUTE_METRICS_FILE:-/tmp/devcontainer-github-api-route.metrics.tsv}"
readonly GITHUB_ROUTE_BENCHMARK_FILE="${DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_FILE:-/tmp/devcontainer-github-api-route.benchmark.tsv}"
readonly GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.benchmark.summary}"
readonly GITHUB_ROUTE_RECOMMENDATION_FILE="${DEVCONTAINER_GITHUB_ROUTE_RECOMMENDATION_FILE:-/tmp/devcontainer-github-api-route.recommendation}"

CONNECT_TIMEOUT="$(cfg_uint "${DEVCONTAINER_GITHUB_API_ROUTE_CONNECT_TIMEOUT:-3}" 3 1 30)"
readonly CONNECT_TIMEOUT
MAX_TIME="$(cfg_uint "${DEVCONTAINER_GITHUB_API_ROUTE_MAX_TIME:-7}" 7 2 120)"
readonly MAX_TIME
MIN_SCORE="$(cfg_uint "${DEVCONTAINER_GITHUB_API_MIN_SCORE:-85}" 85 1 150)"
readonly MIN_SCORE
MAX_CANDIDATES="$(cfg_uint "${DEVCONTAINER_GITHUB_API_MAX_CANDIDATES:-16}" 16 1 64)"
readonly MAX_CANDIDATES

readonly RESOLVERS="${DEVCONTAINER_GITHUB_API_RESOLVERS:-185.228.168.9 185.228.169.9 1.1.1.1 1.0.0.1 8.8.8.8 8.8.4.4 9.9.9.9 149.112.112.112 208.67.222.222 208.67.220.220 76.76.2.0 76.76.10.0 94.140.14.14 94.140.15.15}"
readonly SEED_CANDIDATES="${DEVCONTAINER_GITHUB_API_SEED_CANDIDATES:-140.82.112.5 140.82.112.6 140.82.113.5 140.82.113.6 140.82.114.5 140.82.114.6 140.82.121.5 140.82.121.6}"

ENABLE_META_CANDIDATES="$(cfg_bool "${DEVCONTAINER_GITHUB_API_ENABLE_META_CANDIDATES:-true}" true)"
readonly ENABLE_META_CANDIDATES
META_CANDIDATE_TIMEOUT="$(cfg_uint "${DEVCONTAINER_GITHUB_API_META_CANDIDATE_TIMEOUT:-4}" 4 1 30)"
readonly META_CANDIDATE_TIMEOUT

GITHUB_API_VERSION="${DEVCONTAINER_GITHUB_API_VERSION:-2022-11-28}"
case "${GITHUB_API_VERSION}" in
    2022-11-28 | 2026-03-10) : ;;
    *)
        # Keep this bounded to a date-shaped token; unsupported versions are
        # detected by GitHub as 410 Gone during probes.
        if [[ ! "${GITHUB_API_VERSION}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
            GITHUB_API_VERSION="2022-11-28"
        fi
        ;;
esac
readonly GITHUB_API_VERSION

FOLLOW_REDIRECTS="$(cfg_bool "${DEVCONTAINER_GITHUB_API_FOLLOW_REDIRECTS:-true}" true)"
readonly FOLLOW_REDIRECTS
MAX_REDIRS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_MAX_REDIRS:-3}" 3 0 10)"
readonly MAX_REDIRS

FUNCTIONALITY_PROFILE="${DEVCONTAINER_GITHUB_API_FUNCTIONALITY_PROFILE:-copilot}"
case "${FUNCTIONALITY_PROFILE}" in
    core | copilot | full) : ;;
    api-core) FUNCTIONALITY_PROFILE="core" ;;
    api-copilot | core-copilot) FUNCTIONALITY_PROFILE="copilot" ;;
    api-full) FUNCTIONALITY_PROFILE="full" ;;
    *) FUNCTIONALITY_PROFILE="copilot" ;;
esac
readonly FUNCTIONALITY_PROFILE

FUNCTIONALITY_STRICT="$(cfg_bool "${DEVCONTAINER_GITHUB_API_FUNCTIONALITY_STRICT:-false}" false)"
readonly FUNCTIONALITY_STRICT
COPILOT_TOKEN_SHAPED_PROBE="$(cfg_bool "${DEVCONTAINER_GITHUB_API_COPILOT_TOKEN_SHAPED_PROBE:-true}" true)"
readonly COPILOT_TOKEN_SHAPED_PROBE
META_SHAPED_PROBE="$(cfg_bool "${DEVCONTAINER_GITHUB_API_META_SHAPED_PROBE:-true}" true)"
readonly META_SHAPED_PROBE

SUMMARY_FUNCTIONALITY_STATUS="unknown"
SUMMARY_FUNCTIONALITY_DETAILS="not-run"
SUMMARY_FUNCTIONALITY_PROFILE="${FUNCTIONALITY_PROFILE}"

ENABLE_AUTH_PROBE="$(cfg_bool "${DEVCONTAINER_ENABLE_GITHUB_API_AUTH_PROBE:-false}" false)"
readonly ENABLE_AUTH_PROBE
ENABLE_COPILOT_INTERNAL_AUTH_PROBE="$(cfg_bool "${DEVCONTAINER_ENABLE_COPILOT_INTERNAL_AUTH_PROBE:-false}" false)"
readonly ENABLE_COPILOT_INTERNAL_AUTH_PROBE
AUTH_TOKEN_TIMEOUT_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_AUTH_TOKEN_TIMEOUT_SECONDS:-4}" 4 1 30)"
readonly AUTH_TOKEN_TIMEOUT_SECONDS

CACHE_ENABLED="$(cfg_bool "${DEVCONTAINER_GITHUB_API_ROUTE_CACHE_ENABLED:-true}" true)"
readonly CACHE_ENABLED
readonly CACHE_FILE="${DEVCONTAINER_GITHUB_API_ROUTE_CACHE_FILE:-${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/devcontainer/network/github-api-route.cache.tsv}"
CACHE_MAX_AGE_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_ROUTE_CACHE_MAX_AGE_SECONDS:-604800}" 604800 60 31536000)"
readonly CACHE_MAX_AGE_SECONDS
CACHE_MAX_ENTRIES="$(cfg_uint "${DEVCONTAINER_GITHUB_API_ROUTE_CACHE_MAX_ENTRIES:-128}" 128 8 2048)"
readonly CACHE_MAX_ENTRIES
RECENT_FAILURE_HARD_BLOCK_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_RECENT_FAILURE_HARD_BLOCK_SECONDS:-0}" 0 0 86400)"
readonly RECENT_FAILURE_HARD_BLOCK_SECONDS

# v1.8.0 — historical stability policy.
# The cache remains advisory, but now carries enough bounded state for:
# - recent failure penalty;
# - per-IP cooldown;
# - gradual recovery after a bad period;
# - p95 latency scoring instead of relying only on the last probe.
RECENT_FAILURE_WINDOW_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_RECENT_FAILURE_WINDOW_SECONDS:-1800}" 1800 60 86400)"
readonly RECENT_FAILURE_WINDOW_SECONDS
RECENT_FAILURE_PENALTY_PER_FAILURE="$(cfg_uint "${DEVCONTAINER_GITHUB_API_RECENT_FAILURE_PENALTY_PER_FAILURE:-10}" 10 0 100)"
readonly RECENT_FAILURE_PENALTY_PER_FAILURE
RECENT_FAILURE_PENALTY_MAX="$(cfg_uint "${DEVCONTAINER_GITHUB_API_RECENT_FAILURE_PENALTY_MAX:-35}" 35 0 100)"
readonly RECENT_FAILURE_PENALTY_MAX
COOLDOWN_FAILURE_THRESHOLD="$(cfg_uint "${DEVCONTAINER_GITHUB_API_COOLDOWN_FAILURE_THRESHOLD:-2}" 2 1 20)"
readonly COOLDOWN_FAILURE_THRESHOLD
COOLDOWN_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_COOLDOWN_SECONDS:-600}" 600 0 86400)"
readonly COOLDOWN_SECONDS
RECOVERY_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_RECOVERY_SECONDS:-1800}" 1800 0 86400)"
readonly RECOVERY_SECONDS
P95_SAMPLE_LIMIT="$(cfg_uint "${DEVCONTAINER_GITHUB_API_P95_SAMPLE_LIMIT:-20}" 20 3 200)"
readonly P95_SAMPLE_LIMIT
P95_GOOD_MS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_P95_GOOD_MS:-500}" 500 1 120000)"
readonly P95_GOOD_MS
P95_ACCEPTABLE_MS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_P95_ACCEPTABLE_MS:-1000}" 1000 1 120000)"
readonly P95_ACCEPTABLE_MS
P95_SLOW_MS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_P95_SLOW_MS:-1500}" 1500 1 120000)"
readonly P95_SLOW_MS

readonly CACHE_LOCK_FILE="${DEVCONTAINER_GITHUB_API_ROUTE_CACHE_LOCK_FILE:-${CACHE_FILE}.lock}"

HYSTERESIS_SCORE_MARGIN="$(cfg_uint "${DEVCONTAINER_GITHUB_API_HYSTERESIS_SCORE_MARGIN:-8}" 8 0 100)"
readonly HYSTERESIS_SCORE_MARGIN
HYSTERESIS_LATENCY_RATIO_PERCENT="$(cfg_uint "${DEVCONTAINER_GITHUB_API_HYSTERESIS_LATENCY_RATIO_PERCENT:-75}" 75 1 100)"
readonly HYSTERESIS_LATENCY_RATIO_PERCENT
OPTIMIZE_WHEN_CURRENT_OK="$(cfg_bool "${DEVCONTAINER_GITHUB_API_OPTIMIZE_WHEN_CURRENT_OK:-true}" true)"
readonly OPTIMIZE_WHEN_CURRENT_OK
FORCE_RESELECT="$(cfg_bool "${DEVCONTAINER_GITHUB_API_FORCE_RESELECT:-false}" false)"
readonly FORCE_RESELECT

case "${DEVCONTAINER_GITHUB_API_ROUTE_PROXY_MODE:-auto}" in
    auto | direct | respect) readonly PROXY_MODE="${DEVCONTAINER_GITHUB_API_ROUTE_PROXY_MODE:-auto}" ;;
    *) readonly PROXY_MODE="auto" ;;
esac

ENABLE_IPV6="$(cfg_bool "${DEVCONTAINER_GITHUB_API_ENABLE_IPV6:-false}" false)"
readonly ENABLE_IPV6
PARALLEL_PROBES="$(cfg_bool "${DEVCONTAINER_GITHUB_API_PARALLEL_PROBES:-true}" true)"
readonly PARALLEL_PROBES
readonly PROBE_TMP_DIR="${DEVCONTAINER_GITHUB_API_PROBE_TMP_DIR:-/tmp}"

OPENSSL_PREFLIGHT="$(cfg_bool "${DEVCONTAINER_GITHUB_API_OPENSSL_PREFLIGHT:-false}" false)"
readonly OPENSSL_PREFLIGHT
OPENSSL_PREFLIGHT_TIMEOUT="$(cfg_uint "${DEVCONTAINER_GITHUB_API_OPENSSL_PREFLIGHT_TIMEOUT:-2}" 2 1 20)"
readonly OPENSSL_PREFLIGHT_TIMEOUT

readonly HOSTS_LOCK_FILE="${DEVCONTAINER_GITHUB_API_HOSTS_LOCK_FILE:-/tmp/devcontainer-github-api-route.hosts.lock}"
CACHE_LOCK_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_CACHE_LOCK_WAIT_SECONDS:-10}" 10 1 120)"
readonly CACHE_LOCK_WAIT_SECONDS
HOSTS_LOCK_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_HOSTS_LOCK_WAIT_SECONDS:-15}" 15 1 120)"
readonly HOSTS_LOCK_WAIT_SECONDS
STRICT_VERIFY_EXPECTED_IP="$(cfg_bool "${DEVCONTAINER_GITHUB_API_STRICT_VERIFY_EXPECTED_IP:-true}" true)"
readonly STRICT_VERIFY_EXPECTED_IP
ROLLBACK_ON_VERIFY_FAILURE="$(cfg_bool "${DEVCONTAINER_GITHUB_API_ROLLBACK_ON_VERIFY_FAILURE:-true}" true)"
readonly ROLLBACK_ON_VERIFY_FAILURE
DRY_RUN="$(cfg_bool "${DEVCONTAINER_GITHUB_API_ROUTE_DRY_RUN:-false}" false)"
readonly DRY_RUN

BENCHMARK_DURATION_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_BENCHMARK_DURATION_SECONDS:-600}" 600 1 7200)"
readonly BENCHMARK_DURATION_SECONDS
BENCHMARK_INTERVAL_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_BENCHMARK_INTERVAL_SECONDS:-10}" 10 1 600)"
readonly BENCHMARK_INTERVAL_SECONDS
BENCHMARK_MAX_SAMPLES="$(cfg_uint "${DEVCONTAINER_GITHUB_API_BENCHMARK_MAX_SAMPLES:-0}" 0 0 10000)"
readonly BENCHMARK_MAX_SAMPLES
BENCHMARK_INCLUDE_CANDIDATES="$(cfg_bool "${DEVCONTAINER_GITHUB_API_BENCHMARK_INCLUDE_CANDIDATES:-true}" true)"
readonly BENCHMARK_INCLUDE_CANDIDATES
BENCHMARK_UPDATE_CACHE="$(cfg_bool "${DEVCONTAINER_GITHUB_API_BENCHMARK_UPDATE_CACHE:-true}" true)"
readonly BENCHMARK_UPDATE_CACHE
BENCHMARK_RECOMMEND_MIN_SAMPLES="$(cfg_uint "${DEVCONTAINER_GITHUB_API_BENCHMARK_RECOMMEND_MIN_SAMPLES:-5}" 5 1 10000)"
readonly BENCHMARK_RECOMMEND_MIN_SAMPLES
BENCHMARK_MAX_FAIL_RATE_PERCENT="$(cfg_uint "${DEVCONTAINER_GITHUB_API_BENCHMARK_MAX_FAIL_RATE_PERCENT:-10}" 10 0 100)"
readonly BENCHMARK_MAX_FAIL_RATE_PERCENT
BENCHMARK_MIN_IMPROVEMENT_PERCENT="$(cfg_uint "${DEVCONTAINER_GITHUB_API_BENCHMARK_MIN_IMPROVEMENT_PERCENT:-25}" 25 0 100)"
readonly BENCHMARK_MIN_IMPROVEMENT_PERCENT
BENCHMARK_RECOMMENDATION_TTL_SECONDS="$(cfg_uint "${DEVCONTAINER_GITHUB_API_BENCHMARK_RECOMMENDATION_TTL_SECONDS:-86400}" 86400 60 604800)"
readonly BENCHMARK_RECOMMENDATION_TTL_SECONDS

# -----------------------------------------------------------------------------
# Logging / reporting
# -----------------------------------------------------------------------------
ts() { date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date; }
now_epoch() { date '+%s' 2> /dev/null || printf '0'; }

log_info() { printf '%s\n' "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { printf '%s\n' "⚠️  [${SCRIPT_NAME}] $*"; }
log_ok() { printf '%s\n' "✅ [${SCRIPT_NAME}] $*"; }
log_debug() {
    if [[ "${DEVCONTAINER_VERBOSE_NETWORK:-false}" == "true" ]]; then
        printf '%s\n' "🔎 [${SCRIPT_NAME}] $*" >&2
    fi
}

ensure_parent_dir() {
    local path="$1" dir
    dir="$(dirname "${path}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${dir}" 2> /dev/null || true
}

write_atomic_file() {
    local target content mode dir tmp
    target="${1:-}"
    content="${2:-}"
    mode="${3:-0644}"
    [[ -n "${target}" ]] || return 1
    ensure_parent_dir "${target}"
    dir="$(dirname "${target}" 2> /dev/null || printf '/tmp')"
    tmp="$(mktemp "${dir%/}/.${SCRIPT_NAME}.XXXXXX" 2> /dev/null || true)"
    [[ -n "${tmp}" ]] || return 1
    printf '%s' "${content}" > "${tmp}" 2> /dev/null || {
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

write_report_header() {
    ensure_parent_dir "${GITHUB_ROUTE_REPORT_FILE}"
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'host=%s\n' "${GITHUB_API_HOST}"
        printf 'action=%s\n' "${ACTION}"
        printf 'allow_custom_host=%s\n' "${ALLOW_CUSTOM_HOST}"
        printf 'connect_timeout=%s\n' "${CONNECT_TIMEOUT}"
        printf 'max_time=%s\n' "${MAX_TIME}"
        printf 'min_score=%s\n' "${MIN_SCORE}"
        printf 'max_candidates=%s\n' "${MAX_CANDIDATES}"
        printf 'enable_meta_candidates=%s\n' "${ENABLE_META_CANDIDATES}"
        printf 'meta_candidate_timeout=%s\n' "${META_CANDIDATE_TIMEOUT}"
        printf 'api_version=%s\n' "${GITHUB_API_VERSION}"
        printf 'functionality_profile=%s\n' "${FUNCTIONALITY_PROFILE}"
        printf 'functionality_strict=%s\n' "${FUNCTIONALITY_STRICT}"
        printf 'follow_redirects=%s\n' "${FOLLOW_REDIRECTS}"
        printf 'max_redirs=%s\n' "${MAX_REDIRS}"
        printf 'cache_enabled=%s\n' "${CACHE_ENABLED}"
        printf 'cache_file=%s\n' "${CACHE_FILE}"
        printf 'status_file=%s\n' "${GITHUB_ROUTE_STATUS_FILE}"
        printf 'summary_file=%s\n' "${GITHUB_ROUTE_SUMMARY_FILE}"
        printf 'metrics_file=%s\n' "${GITHUB_ROUTE_METRICS_FILE}"
        printf 'parallel_probes=%s\n' "${PARALLEL_PROBES}"
        printf 'proxy_mode=%s\n' "${PROXY_MODE}"
        printf 'enable_ipv6=%s\n' "${ENABLE_IPV6}"
        printf 'optimize_when_current_ok=%s\n' "${OPTIMIZE_WHEN_CURRENT_OK}"
        printf 'cache_lock_wait_seconds=%s\n' "${CACHE_LOCK_WAIT_SECONDS}"
        printf 'hosts_lock_wait_seconds=%s\n' "${HOSTS_LOCK_WAIT_SECONDS}"
        printf 'strict_verify_expected_ip=%s\n' "${STRICT_VERIFY_EXPECTED_IP}"
        printf 'rollback_on_verify_failure=%s\n' "${ROLLBACK_ON_VERIFY_FAILURE}"
        printf 'dry_run=%s\n' "${DRY_RUN}"
        printf 'recent_failure_window_seconds=%s\n' "${RECENT_FAILURE_WINDOW_SECONDS}"
        printf 'recent_failure_penalty_per_failure=%s\n' "${RECENT_FAILURE_PENALTY_PER_FAILURE}"
        printf 'recent_failure_penalty_max=%s\n' "${RECENT_FAILURE_PENALTY_MAX}"
        printf 'cooldown_failure_threshold=%s\n' "${COOLDOWN_FAILURE_THRESHOLD}"
        printf 'cooldown_seconds=%s\n' "${COOLDOWN_SECONDS}"
        printf 'recovery_seconds=%s\n' "${RECOVERY_SECONDS}"
        printf 'p95_sample_limit=%s\n' "${P95_SAMPLE_LIMIT}"
        printf 'p95_good_ms=%s\n' "${P95_GOOD_MS}"
        printf 'p95_acceptable_ms=%s\n' "${P95_ACCEPTABLE_MS}"
        printf 'p95_slow_ms=%s\n' "${P95_SLOW_MS}"
        printf 'benchmark_file=%s\n' "${GITHUB_ROUTE_BENCHMARK_FILE}"
        printf 'benchmark_summary_file=%s\n' "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}"
        printf 'recommendation_file=%s\n' "${GITHUB_ROUTE_RECOMMENDATION_FILE}"
        printf 'benchmark_duration_seconds=%s\n' "${BENCHMARK_DURATION_SECONDS}"
        printf 'benchmark_interval_seconds=%s\n' "${BENCHMARK_INTERVAL_SECONDS}"
        printf 'benchmark_max_samples=%s\n' "${BENCHMARK_MAX_SAMPLES}"
        printf 'benchmark_include_candidates=%s\n' "${BENCHMARK_INCLUDE_CANDIDATES}"
        printf 'benchmark_update_cache=%s\n' "${BENCHMARK_UPDATE_CACHE}"
        printf 'benchmark_recommend_min_samples=%s\n' "${BENCHMARK_RECOMMEND_MIN_SAMPLES}"
        printf 'benchmark_max_fail_rate_percent=%s\n' "${BENCHMARK_MAX_FAIL_RATE_PERCENT}"
        printf 'benchmark_min_improvement_percent=%s\n' "${BENCHMARK_MIN_IMPROVEMENT_PERCENT}"
        printf 'benchmark_recommendation_ttl_seconds=%s\n' "${BENCHMARK_RECOMMENDATION_TTL_SECONDS}"
        printf '\n'
    } > "${GITHUB_ROUTE_REPORT_FILE}" 2> /dev/null || true
}

append_report() {
    ensure_parent_dir "${GITHUB_ROUTE_REPORT_FILE}"
    printf '%s\n' "$*" >> "${GITHUB_ROUTE_REPORT_FILE}" 2> /dev/null || true
}

write_status() {
    local value
    value="${1:-unknown}"
    write_atomic_file "${GITHUB_ROUTE_STATUS_FILE}" "$(printf '%s\n' "${value}")" 2> /dev/null || {
        ensure_parent_dir "${GITHUB_ROUTE_STATUS_FILE}"
        printf '%s\n' "${value}" > "${GITHUB_ROUTE_STATUS_FILE}" 2> /dev/null || true
    }
}

write_summary() {
    local status selected_ip selected_score selected_latency current_ip current_score current_latency reason
    local decision selected_p95 current_p95 cooldown_remaining recovery_remaining content
    status="${1:-unknown}"
    selected_ip="${2:-}"
    selected_score="${3:-}"
    selected_latency="${4:-}"
    current_ip="${5:-}"
    current_score="${6:-}"
    current_latency="${7:-}"
    reason="${8:-}"
    decision="${9:-${reason:-unknown}}"
    selected_p95="${10:-unknown}"
    current_p95="${11:-unknown}"
    cooldown_remaining="${12:-0}"
    recovery_remaining="${13:-0}"
    content="$(
        printf 'status=%s\n' "${status}"
        printf 'selected_ip=%s\n' "${selected_ip:-none}"
        printf 'selected_score=%s\n' "${selected_score:-unknown}"
        printf 'selected_latency_ms=%s\n' "${selected_latency:-unknown}"
        printf 'selected_p95_latency_ms=%s\n' "${selected_p95:-unknown}"
        printf 'current_ip=%s\n' "${current_ip:-unknown}"
        printf 'current_score=%s\n' "${current_score:-unknown}"
        printf 'current_latency_ms=%s\n' "${current_latency:-unknown}"
        printf 'current_p95_latency_ms=%s\n' "${current_p95:-unknown}"
        printf 'cooldown_remaining_seconds=%s\n' "${cooldown_remaining:-0}"
        printf 'recovery_remaining_seconds=%s\n' "${recovery_remaining:-0}"
        printf 'reason=%s\n' "${reason:-none}"
        printf 'decision_reason=%s\n' "${decision:-none}"
        printf 'api_version=%s\n' "${GITHUB_API_VERSION}"
        printf 'functionality_profile=%s\n' "${SUMMARY_FUNCTIONALITY_PROFILE:-${FUNCTIONALITY_PROFILE}}"
        printf 'functionality_status=%s\n' "${SUMMARY_FUNCTIONALITY_STATUS:-unknown}"
        printf 'functionality_details=%s\n' "${SUMMARY_FUNCTIONALITY_DETAILS:-none}"
        printf 'report=%s\n' "${GITHUB_ROUTE_REPORT_FILE}"
        printf 'metrics=%s\n' "${GITHUB_ROUTE_METRICS_FILE}"
        printf 'benchmark=%s\n' "${GITHUB_ROUTE_BENCHMARK_FILE}"
        printf 'benchmark_summary=%s\n' "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}"
        printf 'recommendation=%s\n' "${GITHUB_ROUTE_RECOMMENDATION_FILE}"
        printf 'cache=%s\n' "${CACHE_FILE}"
        printf 'completed_at=%s\n' "$(ts)"
    )"
    write_atomic_file "${GITHUB_ROUTE_SUMMARY_FILE}" "$(printf '%s\n' "${content}")" 0644 || {
        ensure_parent_dir "${GITHUB_ROUTE_SUMMARY_FILE}"
        printf '%s\n' "${content}" > "${GITHUB_ROUTE_SUMMARY_FILE}" 2> /dev/null || true
    }
}

write_metrics_header() {
    ensure_parent_dir "${GITHUB_ROUTE_METRICS_FILE}"
    printf 'timestamp\tip\tscore\troot_http\trate_http\tuser_http\tcopilot_token_http\tmeta_http\tlatency_ms\tp95_latency_ms\trecent_failures\tcooldown_remaining_seconds\trecovery_remaining_seconds\tremote_ip\tselected\tstatus\tfunctionality_profile\tcapability_summary\treason\n' > "${GITHUB_ROUTE_METRICS_FILE}" 2> /dev/null || true
}

append_candidate_metric() {
    local ip score root_http rate_http user_http latency_ms remote reason selected status p95_latency recent_failures cooldown_remaining recovery_remaining
    local copilot_http meta_http capability_summary
    ip="${1:-}"
    score="${2:-0}"
    root_http="${3:-000}"
    rate_http="${4:-000}"
    user_http="${5:-000}"
    latency_ms="${6:-0}"
    remote="${7:-}"
    reason="${8:-}"
    selected="${9:-false}"
    p95_latency="${10:-unknown}"
    recent_failures="${11:-0}"
    cooldown_remaining="${12:-0}"
    recovery_remaining="${13:-0}"
    copilot_http="$(extract_reason_field copilot_token_http "${reason}")"
    meta_http="$(extract_reason_field meta_http "${reason}")"
    capability_summary="$(extract_reason_field capabilities "${reason}")"
    reason="$(printf '%s' "${reason}" | tr '\t\n' '  ')"
    capability_summary="$(printf '%s' "${capability_summary:-unknown}" | tr '\t\n' '  ')"
    status="fail"
    if is_nonnegative_int "${score}" && ((score >= MIN_SCORE)) && { ! is_nonnegative_int "${cooldown_remaining}" || ((cooldown_remaining == 0)); }; then
        status="ok"
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$(ts)" "${ip}" "${score}" "${root_http}" "${rate_http}" "${user_http}" \
        "${copilot_http:-skipped}" "${meta_http:-skipped}" "${latency_ms}" \
        "${p95_latency:-unknown}" "${recent_failures:-0}" "${cooldown_remaining:-0}" "${recovery_remaining:-0}" \
        "${remote:-unknown}" "${selected}" "${status}" "${FUNCTIONALITY_PROFILE}" "${capability_summary:-unknown}" "${reason}" \
        >> "${GITHUB_ROUTE_METRICS_FILE}" 2> /dev/null || true
}
# -----------------------------------------------------------------------------
# Generic helpers
# -----------------------------------------------------------------------------
has_cmd() { command -v "$1" > /dev/null 2>&1; }
is_nonnegative_int() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

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

is_ipv6() {
    [[ "$1" == *:* ]] || return 1
    if has_cmd python3; then
        python3 - "$1" << 'PY' > /dev/null 2>&1
import ipaddress, sys
try:
    ip = ipaddress.IPv6Address(sys.argv[1])
except Exception:
    sys.exit(1)

# Reject IPv4-mapped IPv6 (::ffff:x.y.z.w). It is not a native IPv6 route and,
# in this project, it can represent the same broken IPv4 edge that triggered the
# route fix in the first place.
if ip.ipv4_mapped is not None:
    sys.exit(1)

# Reject addresses that cannot be valid public HTTPS candidates for GitHub API.
if ip.is_unspecified or ip.is_loopback or ip.is_multicast or ip.is_link_local:
    sys.exit(1)

sys.exit(0)
PY
        return $?
    fi
    [[ "$1" =~ ^[0-9A-Fa-f:]+$ ]] || return 1
    [[ "$1" != ::ffff:* && "$1" != fe80:* && "$1" != ::1 && "$1" != ff* ]]
}

is_public_ipv4_candidate() {
    is_ipv4 "$1" || return 1
    awk -v ip="$1" 'BEGIN {
        split(ip,a,".");
        a1=a[1]+0; a2=a[2]+0; a3=a[3]+0; a4=a[4]+0;

        # Reject non-routable, local, documentation, benchmarking,
        # multicast, reserved and broadcast ranges. Candidate IPs for
        # public GitHub API routing must be globally routable IPv4 addresses.
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

is_ip_candidate() {
    if is_public_ipv4_candidate "$1"; then return 0; fi
    [[ "${ENABLE_IPV6}" == "true" ]] && is_ipv6 "$1"
}

is_resolver_ip() {
    # Resolver addresses may legitimately be local/private in custom setups.
    if is_ipv4 "$1"; then return 0; fi
    [[ "$1" == *:* ]] && return 0
    return 1
}

ip_family() {
    if is_ipv4 "$1"; then
        printf '4'
        return 0
    fi
    if is_ipv6 "$1"; then
        printf '6'
        return 0
    fi
    printf 'unknown'
}

curl_ip_flag() {
    case "$(ip_family "$1")" in
        4) printf -- '-4' ;;
        6) printf -- '-6' ;;
        *) printf '' ;;
    esac
}

curl_resolve_value() {
    local host="$1" ip="$2"
    if is_ipv6 "${ip}"; then
        printf '%s:443:[%s]' "${host}" "${ip}"
    else
        printf '%s:443:%s' "${host}" "${ip}"
    fi
}

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

extract_field() {
    local key="$1" line="$2"
    printf '%s' "${line}" | tr '|' '\n' | awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}'
}

extract_reason_field() {
    local key reason
    key="${1:-}"
    reason="${2:-}"
    [[ -n "${key}" ]] || return 0
    printf '%s' "${reason}" | tr ';' '\n' | awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}'
}

set_summary_functionality_from_reason() {
    local reason status details
    reason="${1:-}"
    status="$(extract_reason_field capability_status "${reason}")"
    details="$(extract_reason_field capabilities "${reason}")"
    SUMMARY_FUNCTIONALITY_PROFILE="${FUNCTIONALITY_PROFILE}"
    SUMMARY_FUNCTIONALITY_STATUS="${status:-unknown}"
    SUMMARY_FUNCTIONALITY_DETAILS="${details:-none}"
}

set_summary_functionality_manual() {
    SUMMARY_FUNCTIONALITY_PROFILE="${FUNCTIONALITY_PROFILE}"
    SUMMARY_FUNCTIONALITY_STATUS="${1:-unknown}"
    SUMMARY_FUNCTIONALITY_DETAILS="${2:-none}"
}

is_safe_api_path_token() {
    case "${1:-}" in
        / | /rate_limit | /user | /meta | /copilot_internal/v2/token) return 0 ;;
        *) return 1 ;;
    esac
}

http_is_rate_limit_or_forbidden() {
    case "${1:-000}" in
        403 | 429) return 0 ;;
        *) return 1 ;;
    esac
}

http_is_reachable() {
    local code tls
    code="${1:-000}"
    tls="${2:-?}"
    [[ -n "${code}" && "${code}" != "000" && "${tls}" == "0" ]]
}

root_http_is_degraded_reachable() {
    local code tls
    code="${1:-000}"
    tls="${2:-?}"
    http_is_rate_limit_or_forbidden "${code}" && [[ "${tls}" == "0" ]]
}

github_api_root_body_is_shaped() {
    local body
    body="${1:-}"
    printf '%s' "${body}" | grep -q 'current_user_url' \
        && printf '%s' "${body}" | grep -q 'https://api.github.com/user' \
        && printf '%s' "${body}" | grep -q 'rate_limit_url'
}

github_api_json_content_type_is_plausible() {
    case "${1:-}" in
        *application/json* | *text/plain* | '') return 0 ;;
        *) return 1 ;;
    esac
}

float_ms() {
    local value="$1"
    value="${value/,/.}"
    LC_ALL=C awk -v s="${value}" 'BEGIN { if (s == "") s=0; printf "%d", s*1000 }' 2> /dev/null
}

unique_ordered_trim() {
    local max="${1:-${MAX_CANDIDATES}}"
    awk -v max="${max}" 'NF && !seen[$0]++ { print; count++; if (count >= max) exit }'
}

split_words_to_lines() {
    local value="$1" item
    local -a items=()
    read -r -a items <<< "${value}"
    for item in "${items[@]}"; do
        [[ -n "${item}" ]] && printf '%s\n' "${item}"
    done
}

has_proxy_env() {
    [[ -n "${HTTPS_PROXY:-}${https_proxy:-}${HTTP_PROXY:-}${http_proxy:-}${ALL_PROXY:-}${all_proxy:-}" ]]
}

make_temp_file() {
    local prefix="${1:-tmp}" dir="${2:-/tmp}" tmp=""
    mkdir -p "${dir}" 2> /dev/null || dir="/tmp"
    tmp="$(mktemp "${dir%/}/${prefix}.XXXXXX" 2> /dev/null || true)"
    if [[ -n "${tmp}" ]]; then
        printf '%s\n' "${tmp}"
        return 0
    fi
    tmp="$(mktemp "/tmp/${prefix}.XXXXXX" 2> /dev/null || true)"
    [[ -n "${tmp}" ]] && printf '%s\n' "${tmp}"
}

make_temp_dir() {
    local prefix="${1:-tmp}" dir="${2:-/tmp}" tmp=""
    mkdir -p "${dir}" 2> /dev/null || dir="/tmp"
    tmp="$(mktemp -d "${dir%/}/${prefix}.XXXXXX" 2> /dev/null || true)"
    if [[ -n "${tmp}" ]]; then
        printf '%s\n' "${tmp}"
        return 0
    fi
    mktemp -d "/tmp/${prefix}.XXXXXX" 2> /dev/null || true
}

read_file_best_effort() {
    local file
    file="${1:-}"
    [[ -r "${file}" ]] || return 1
    sed -n '1,200p' "${file}" 2> /dev/null
}

read_first_line_or() {
    local file fallback value
    file="${1:-}"
    fallback="${2:-unknown}"
    if [[ -r "${file}" ]]; then
        value="$(awk 'NR==1{print; exit}' "${file}" 2> /dev/null || true)"
        printf '%s' "${value:-${fallback}}"
        return 0
    fi
    printf '%s' "${fallback}"
}

safe_remove_temp_file() {
    local file
    file="${1:-}"
    [[ -n "${file}" && "${file}" != "/dev/null" ]] || return 0
    rm -f -- "${file}" 2> /dev/null || true
}

run_with_timeout() {
    local seconds
    seconds="${1:-0}"
    shift || true
    if [[ "${seconds}" =~ ^[0-9]+$ && "${seconds}" -gt 0 ]] && has_cmd timeout; then
        timeout "${seconds}" "$@"
        return $?
    fi
    "$@"
}

# -----------------------------------------------------------------------------
# Curl helpers
# -----------------------------------------------------------------------------
curl_current_route() {
    local output_file="$1" url="$2" mode="$3" family_hint="${4:-4}"
    local -a args=()
    if [[ "${family_hint}" == "4" ]]; then args+=("-4"); fi
    if [[ "${family_hint}" == "6" ]]; then args+=("-6"); fi
    if [[ "${mode}" == "direct" ]]; then args+=(--noproxy '*'); fi
    args+=(-H 'Accept: application/vnd.github+json' -H "X-GitHub-Api-Version: ${GITHUB_API_VERSION}")
    if [[ "${FOLLOW_REDIRECTS}" == "true" ]]; then
        args+=(--location --max-redirs "${MAX_REDIRS}")
    fi

    LC_ALL=C curl "${args[@]}" -sS \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        -o "${output_file}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}|exitcode=%{exitcode}' \
        "${url}" 2> /dev/null || true
}

curl_candidate_route() {
    local output_file="$1" path="$2" ip="$3"
    is_safe_api_path_token "${path}" || return 2
    local flag resolve_value
    local -a args=()

    flag="$(curl_ip_flag "${ip}")"
    [[ -n "${flag}" ]] && args+=("${flag}")
    args+=(--noproxy '*')
    args+=(-H 'Accept: application/vnd.github+json' -H "X-GitHub-Api-Version: ${GITHUB_API_VERSION}")
    if [[ "${FOLLOW_REDIRECTS}" == "true" ]]; then
        args+=(--location --max-redirs "${MAX_REDIRS}")
    fi

    resolve_value="$(curl_resolve_value "${GITHUB_API_HOST}" "${ip}")"

    LC_ALL=C curl "${args[@]}" -sS \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        --resolve "${resolve_value}" \
        -o "${output_file}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_connect=%{time_connect}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}|exitcode=%{exitcode}' \
        "https://${GITHUB_API_HOST}${path}" 2> /dev/null || true
}

# -----------------------------------------------------------------------------
# Cache helpers
# TSV columns, backward compatible with v1.7.0:
#  1 ip
#  2 success_count
#  3 failure_count
#  4 last_success_epoch
#  5 last_failure_epoch
#  6 last_score
#  7 last_latency_ms
#  8 selected_count
#  9 last_selected_epoch
# 10 cooldown_until_epoch          [v1.8.0]
# 11 recovery_until_epoch          [v1.8.0]
# 12 latency_samples_csv           [v1.8.0]
# 13 failure_epochs_csv            [v1.8.0]
# -----------------------------------------------------------------------------
ensure_cache_file_unlocked() {
    [[ "${CACHE_ENABLED}" == "true" ]] || return 1
    local dir
    dir="$(dirname "${CACHE_FILE}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${dir}" 2> /dev/null || return 1
    [[ -f "${CACHE_FILE}" ]] || : > "${CACHE_FILE}" 2> /dev/null || return 1
    chmod 0600 "${CACHE_FILE}" 2> /dev/null || true
    return 0
}

ensure_cache_file() {
    [[ "${CACHE_ENABLED}" == "true" ]] || return 1

    local lock_dir
    lock_dir="$(dirname "${CACHE_LOCK_FILE}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${lock_dir}" 2> /dev/null || true

    if has_cmd flock; then
        (
            flock -x -w "${CACHE_LOCK_WAIT_SECONDS}" 9 || exit 98
            ensure_cache_file_unlocked
        ) 9> "${CACHE_LOCK_FILE}"
        return $?
    fi

    ensure_cache_file_unlocked
}

prune_cache_locked_body() {
    [[ "${CACHE_ENABLED}" == "true" ]] || return 0
    ensure_cache_file_unlocked || return 0

    local tmp cache_dir now max_age
    cache_dir="$(dirname "${CACHE_FILE}" 2> /dev/null || printf '/tmp')"
    tmp="$(make_temp_file github-api-cache-prune "${cache_dir}")"
    [[ -n "${tmp}" ]] || return 0
    now="$(now_epoch)"
    max_age="${CACHE_MAX_AGE_SECONDS}"

    awk -v now="${now}" -v max_age="${max_age}" '
        BEGIN { FS=OFS="\t" }
        NF >= 9 {
            ip=$1; last_success=$4+0; last_failure=$5+0;
            last_seen=(last_success > last_failure ? last_success : last_failure);
            if (last_seen <= 0) next;
            if ((now - last_seen) > max_age) next;
            print last_seen, $0;
        }' "${CACHE_FILE}" 2> /dev/null \
        | sort -rn -k1,1 2> /dev/null \
        | head -n "${CACHE_MAX_ENTRIES}" 2> /dev/null \
        | cut -f2- > "${tmp}" 2> /dev/null

    if [[ -s "${tmp}" || -f "${CACHE_FILE}" ]]; then
        mv -f "${tmp}" "${CACHE_FILE}" 2> /dev/null || rm -f "${tmp}" 2> /dev/null || true
        chmod 0600 "${CACHE_FILE}" 2> /dev/null || true
    else
        rm -f "${tmp}" 2> /dev/null || true
    fi
}

prune_cache() {
    [[ "${CACHE_ENABLED}" == "true" ]] || return 0
    local lock_dir
    lock_dir="$(dirname "${CACHE_LOCK_FILE}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${lock_dir}" 2> /dev/null || true
    if has_cmd flock; then
        (
            flock -x -w "${CACHE_LOCK_WAIT_SECONDS}" 9 || exit 0
            prune_cache_locked_body
        ) 9> "${CACHE_LOCK_FILE}"
        return $?
    fi
    prune_cache_locked_body
}

clear_cache() {
    [[ "${CACHE_ENABLED}" == "true" ]] || return 0
    local lock_dir
    lock_dir="$(dirname "${CACHE_LOCK_FILE}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${lock_dir}" 2> /dev/null || true
    if has_cmd flock; then
        (
            flock -x -w "${CACHE_LOCK_WAIT_SECONDS}" 9 || exit 0
            ensure_parent_dir "${CACHE_FILE}"
            : > "${CACHE_FILE}" 2> /dev/null || true
            chmod 0600 "${CACHE_FILE}" 2> /dev/null || true
        ) 9> "${CACHE_LOCK_FILE}"
    else
        ensure_parent_dir "${CACHE_FILE}"
        : > "${CACHE_FILE}" 2> /dev/null || true
        chmod 0600 "${CACHE_FILE}" 2> /dev/null || true
    fi
}

cache_candidates() {
    [[ "${CACHE_ENABLED}" == "true" ]] || return 0
    ensure_cache_file || return 0

    local now max_age
    now="$(now_epoch)"
    max_age="${CACHE_MAX_AGE_SECONDS}"

    if has_cmd flock; then
        (
            flock -s -w "${CACHE_LOCK_WAIT_SECONDS}" 9 || exit 0
            awk -v now="${now}" -v max_age="${max_age}" -v enable_ipv6="${ENABLE_IPV6}" '
                BEGIN { FS="\t" }
                {
                    ip=$1; last_success=$4+0; cooldown_until=$10+0;
                    ipv4=(ip ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/);
                    ipv6=(ip ~ /:/);
                    if (cooldown_until > now) next;
                    if ((ipv4 || (enable_ipv6 == "true" && ipv6)) && last_success > 0 && (now - last_success) <= max_age) print ip;
                }' "${CACHE_FILE}" 2> /dev/null
        ) 9> "${CACHE_LOCK_FILE}"
    else
        awk -v now="${now}" -v max_age="${max_age}" -v enable_ipv6="${ENABLE_IPV6}" '
            BEGIN { FS="\t" }
            {
                ip=$1; last_success=$4+0; cooldown_until=$10+0;
                ipv4=(ip ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/);
                ipv6=(ip ~ /:/);
                if (cooldown_until > now) next;
                if ((ipv4 || (enable_ipv6 == "true" && ipv6)) && last_success > 0 && (now - last_success) <= max_age) print ip;
            }' "${CACHE_FILE}" 2> /dev/null
    fi
}

cache_candidate_state() {
    local ip now
    ip="${1:-}"
    [[ "${CACHE_ENABLED}" == "true" ]] || {
        printf '0|0|0|0|0|cache-disabled;'
        return 0
    }
    ensure_cache_file || {
        printf '0|0|0|0|0|cache-unavailable;'
        return 0
    }
    now="$(now_epoch)"

    awk -v ip="${ip}" \
        -v now="${now}" \
        -v failure_window="${RECENT_FAILURE_WINDOW_SECONDS}" \
        -v p95_good="${P95_GOOD_MS}" \
        -v p95_acceptable="${P95_ACCEPTABLE_MS}" \
        -v p95_slow="${P95_SLOW_MS}" \
        -v penalty_per_failure="${RECENT_FAILURE_PENALTY_PER_FAILURE}" \
        -v penalty_max="${RECENT_FAILURE_PENALTY_MAX}" '
        BEGIN { FS="\t"; found=0 }
        function sortn(a, n,    i,j,tmp) {
            for (i=1; i<=n; i++) for (j=i+1; j<=n; j++) if (a[j] < a[i]) { tmp=a[i]; a[i]=a[j]; a[j]=tmp }
        }
        function p95_from_csv(csv,    n,parts,i,v,pidx,count) {
            n=split(csv, parts, ",")
            count=0
            delete vals
            for (i=1; i<=n; i++) {
                v=parts[i]+0
                if (v > 0) vals[++count]=v
            }
            if (count <= 0) return 0
            sortn(vals, count)
            pidx=int(count*0.95)
            if (pidx < 1) pidx=1
            if (pidx < count && (count*0.95) > pidx) pidx++
            if (pidx > count) pidx=count
            return vals[pidx]+0
        }
        function recent_failures_from_csv(csv,    n,parts,i,t,c) {
            n=split(csv, parts, ",")
            c=0
            for (i=1; i<=n; i++) {
                t=parts[i]+0
                if (t > 0 && (now - t) >= 0 && (now - t) <= failure_window) c++
            }
            return c
        }
        $1 == ip {
            found=1
            success=$2+0; failure=$3+0; last_success=$4+0; last_failure=$5+0
            selected=$8+0; cooldown_until=$10+0; recovery_until=$11+0
            p95=p95_from_csv($12)
            recent_fail=recent_failures_from_csv($13)
            cooldown_remaining=(cooldown_until > now ? cooldown_until-now : 0)
            recovery_remaining=(recovery_until > now ? recovery_until-now : 0)
            delta=0
            reason=""

            age_success=(last_success > 0 ? now-last_success : 999999999)
            age_failure=(last_failure > 0 ? now-last_failure : 999999999)

            if (success >= 5) { delta += 5; reason=reason "success>=5:+5;" }
            else if (success >= 3) { delta += 3; reason=reason "success>=3:+3;" }
            else if (success >= 1) { delta += 1; reason=reason "success>=1:+1;" }

            if (selected >= 3) { delta += 3; reason=reason "selected>=3:+3;" }
            else if (selected >= 1) { delta += 1; reason=reason "selected>=1:+1;" }

            if (age_success < 3600) { delta += 4; reason=reason "recent-success<1h:+4;" }
            else if (age_success < 86400) { delta += 2; reason=reason "recent-success<1d:+2;" }
            else if (age_success < 604800) { delta += 1; reason=reason "recent-success<7d:+1;" }

            if (age_failure < 300) { delta -= 25; reason=reason "last-failure<5m:-25;" }
            else if (age_failure < 3600) { delta -= 15; reason=reason "last-failure<1h:-15;" }
            else if (age_failure < 21600) { delta -= 10; reason=reason "last-failure<6h:-10;" }
            else if (age_failure < 86400) { delta -= 5; reason=reason "last-failure<1d:-5;" }
            else if (age_failure < 604800) { delta -= 2; reason=reason "last-failure<7d:-2;" }

            if (recent_fail > 0) {
                fp=recent_fail * penalty_per_failure
                if (fp > penalty_max) fp=penalty_max
                delta -= fp
                reason=reason "recent_failures_penalty=-" fp ";"
            }

            if (failure > success && failure >= 2) { delta -= 8; reason=reason "failures>success:-8;" }

            if (p95 > 0) {
                if (p95 <= p95_good) { delta += 5; reason=reason "p95<=" p95_good ":+5;" }
                else if (p95 <= p95_acceptable) { delta += 2; reason=reason "p95<=" p95_acceptable ":+2;" }
                else if (p95 > p95_slow) { delta -= 15; reason=reason "p95>" p95_slow ":-15;" }
                else { delta -= 5; reason=reason "p95-between-acceptable-and-slow:-5;" }
            } else {
                reason=reason "p95=unknown;"
            }

            if (recovery_remaining > 0) {
                delta -= 5
                reason=reason "gradual-recovery-active=-5;"
            }

            if (cooldown_remaining > 0) reason=reason "cooldown-active=" cooldown_remaining ";"
            print delta "|" p95 "|" recent_fail "|" cooldown_remaining "|" recovery_remaining "|" reason
            exit
        }
        END {
            if (!found) print "0|0|0|0|0|no-history;"
        }' "${CACHE_FILE}" 2> /dev/null
}

cache_recent_failure_blocked() {
    local ip state _delta _p95 _recent cooldown_remaining _recovery _reason now last_failure age
    ip="${1:-}"
    state="$(cache_candidate_state "${ip}")"
    IFS='|' read -r _delta _p95 _recent cooldown_remaining _recovery _reason <<< "${state}"
    if [[ "${cooldown_remaining}" =~ ^[0-9]+$ && "${cooldown_remaining}" -gt 0 ]]; then
        return 0
    fi

    [[ "${CACHE_ENABLED}" == "true" ]] || return 1
    [[ "${RECENT_FAILURE_HARD_BLOCK_SECONDS}" -gt 0 ]] || return 1
    ensure_cache_file || return 1
    now="$(now_epoch)"
    last_failure="$(awk -v ip="${ip}" 'BEGIN{FS="\t"} $1==ip{print $5+0; exit}' "${CACHE_FILE}" 2> /dev/null || printf '0')"
    [[ "${last_failure}" =~ ^[0-9]+$ && "${last_failure}" -gt 0 ]] || return 1
    age=$((now - last_failure))
    ((age >= 0 && age < RECENT_FAILURE_HARD_BLOCK_SECONDS))
}

cache_update_locked_body() {
    local ip="$1" ok="$2" score="$3" latency="$4" selected="$5"
    ensure_cache_file_unlocked || return 0

    local now tmp cache_dir
    now="$(now_epoch)"
    cache_dir="$(dirname "${CACHE_FILE}" 2> /dev/null || printf '/tmp')"
    tmp="$(make_temp_file github-api-cache "${cache_dir}")"
    [[ -n "${tmp}" ]] || return 0

    if awk -v ip="${ip}" \
        -v ok="${ok}" \
        -v score="${score}" \
        -v latency="${latency}" \
        -v selected="${selected}" \
        -v now="${now}" \
        -v sample_limit="${P95_SAMPLE_LIMIT}" \
        -v failure_window="${RECENT_FAILURE_WINDOW_SECONDS}" \
        -v cooldown_threshold="${COOLDOWN_FAILURE_THRESHOLD}" \
        -v cooldown_seconds="${COOLDOWN_SECONDS}" \
        -v recovery_seconds="${RECOVERY_SECONDS}" '
        BEGIN { FS=OFS="\t"; found=0 }
        function append_limited_csv(csv, value, limit,    n,parts,i,start,out) {
            if (value == "" || value == "0") return csv
            n=split(csv, parts, ",")
            parts[++n]=value
            start=n-limit+1
            if (start < 1) start=1
            out=""
            for (i=start; i<=n; i++) {
                if (parts[i] == "") continue
                out=(out == "" ? parts[i] : out "," parts[i])
            }
            return out
        }
        function prune_failure_csv(csv,    n,parts,i,t,out) {
            n=split(csv, parts, ",")
            out=""
            for (i=1; i<=n; i++) {
                t=parts[i]+0
                if (t > 0 && (now - t) >= 0 && (now - t) <= failure_window) {
                    out=(out == "" ? t : out "," t)
                }
            }
            return out
        }
        function count_csv(csv,    n,parts,i,c) {
            n=split(csv, parts, ",")
            c=0
            for (i=1; i<=n; i++) if (parts[i] != "") c++
            return c
        }
        function emit_record(ip, success, failure, last_success, last_failure, score, latency, selected_count, last_selected, cooldown_until, recovery_until, latency_samples, failure_epochs) {
            print ip, success, failure, last_success, last_failure, score, latency, selected_count, last_selected, cooldown_until, recovery_until, latency_samples, failure_epochs
        }
        $1 == ip {
            found=1
            success=$2+0; failure=$3+0; last_success=$4+0; last_failure=$5+0
            selected_count=$8+0; last_selected=$9+0
            cooldown_until=$10+0; recovery_until=$11+0
            latency_samples=$12; failure_epochs=$13
            failure_epochs=prune_failure_csv(failure_epochs)

            if (ok == "true") {
                success++
                last_success=now
                if (latency+0 > 0) latency_samples=append_limited_csv(latency_samples, latency+0, sample_limit)
                if (last_failure > 0 && (now - last_failure) <= 86400 && recovery_seconds > 0) recovery_until=now+recovery_seconds
                if (cooldown_until < now) cooldown_until=0
            } else {
                failure++
                last_failure=now
                failure_epochs=append_limited_csv(failure_epochs, now, sample_limit)
                recent=count_csv(prune_failure_csv(failure_epochs))
                if (cooldown_seconds > 0 && recent >= cooldown_threshold) {
                    cooldown_until=now+cooldown_seconds
                    if (recovery_seconds > 0) recovery_until=cooldown_until+recovery_seconds
                }
            }
            if (selected == "true") {
                selected_count++
                last_selected=now
            }
            emit_record(ip, success, failure, last_success, last_failure, score, latency, selected_count, last_selected, cooldown_until, recovery_until, latency_samples, failure_epochs)
            next
        }
        { print }
        END {
            if (!found) {
                success=0; failure=0; last_success=0; last_failure=0; selected_count=0; last_selected=0
                cooldown_until=0; recovery_until=0; latency_samples=""; failure_epochs=""
                if (ok == "true") {
                    success=1
                    last_success=now
                    if (latency+0 > 0) latency_samples=append_limited_csv("", latency+0, sample_limit)
                } else {
                    failure=1
                    last_failure=now
                    failure_epochs=append_limited_csv("", now, sample_limit)
                    if (cooldown_seconds > 0 && cooldown_threshold <= 1) {
                        cooldown_until=now+cooldown_seconds
                        if (recovery_seconds > 0) recovery_until=cooldown_until+recovery_seconds
                    }
                }
                if (selected == "true") {
                    selected_count=1
                    last_selected=now
                }
                emit_record(ip, success, failure, last_success, last_failure, score, latency, selected_count, last_selected, cooldown_until, recovery_until, latency_samples, failure_epochs)
            }
        }' "${CACHE_FILE}" > "${tmp}" 2> /dev/null; then
        mv -f "${tmp}" "${CACHE_FILE}" 2> /dev/null || rm -f "${tmp}" 2> /dev/null || true
        chmod 0600 "${CACHE_FILE}" 2> /dev/null || true
    else
        rm -f "${tmp}" 2> /dev/null || true
    fi
}

cache_update() {
    [[ "${CACHE_ENABLED}" == "true" ]] || return 0

    local lock_dir
    lock_dir="$(dirname "${CACHE_LOCK_FILE}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${lock_dir}" 2> /dev/null || true

    if has_cmd flock; then
        (
            flock -x -w "${CACHE_LOCK_WAIT_SECONDS}" 9 || exit 0
            cache_update_locked_body "$@"
        ) 9> "${CACHE_LOCK_FILE}"
        return $?
    fi

    cache_update_locked_body "$@"
}

# -----------------------------------------------------------------------------
# Proxy-aware short-circuit
# -----------------------------------------------------------------------------
PROXY_ROUTE_REMOTE=""
PROXY_ROUTE_LATENCY_MS=""

probe_proxy_route_if_configured() {
    has_proxy_env || return 1
    [[ "${PROXY_MODE}" == "auto" || "${PROXY_MODE}" == "respect" ]] || return 1

    local tmp meta body http ctype tls remote time_total latency_ms
    tmp="$(make_temp_file github-api-proxy /tmp)"
    [[ -n "${tmp}" ]] || return 1

    meta="$(curl_current_route "${tmp}" "https://${GITHUB_API_HOST}/" "proxy-aware" "auto")"
    body="$(read_file_best_effort "${tmp}" 2> /dev/null || true)"
    safe_remove_temp_file "${tmp}"

    http="$(extract_field http_code "${meta}")"
    ctype="$(extract_field content_type "${meta}")"
    tls="$(extract_field ssl_verify_result "${meta}")"
    remote="$(extract_field remote_ip "${meta}")"
    time_total="$(extract_field time_total "${meta}")"
    latency_ms="$(float_ms "${time_total}")"

    append_report "proxy_route_probe http=${http:-000} ctype=${ctype:-none} tls=${tls:-?} remote=${remote:-unknown} latency_ms=${latency_ms} meta=${meta}"

    if [[ "${http}" == "200" && "${ctype}" == *"application/json"* && "${tls}" == "0" ]] && github_api_root_body_is_shaped "${body}"; then
        PROXY_ROUTE_REMOTE="${remote:-unknown}"
        PROXY_ROUTE_LATENCY_MS="${latency_ms:-0}"
        log_ok "proxy-aware route funcional para ${GITHUB_API_HOST} → remote=${remote:-unknown}, latency=${latency_ms}ms; não alterando /etc/hosts."
        append_report "result=proxy-route-ok remote=${remote:-unknown} latency_ms=${latency_ms}"
        return 0
    fi

    if [[ "${PROXY_MODE}" == "respect" ]]; then
        log_warn "proxy configurado, mas rota via proxy não validou; PROXY_MODE=respect impede alteração de /etc/hosts."
        append_report "result=proxy-route-failed-respect-mode"
        return 1
    fi

    log_warn "proxy detectado, mas rota via proxy não validou; PROXY_MODE=auto seguirá com seleção direta."
    return 1
}

# -----------------------------------------------------------------------------
# GitHub API semantic probes
# -----------------------------------------------------------------------------
probe_github_api_current_route() {
    local tmp meta body http ctype tls remote time_total latency_ms score=0
    tmp="$(make_temp_file github-api-current /tmp)"
    [[ -n "${tmp}" ]] || {
        printf 'fail|unknown|0|0|no-temp-file
'
        return 1
    }

    local family_hint="4"
    [[ "${ENABLE_IPV6}" == "true" ]] && family_hint="auto"
    meta="$(curl_current_route "${tmp}" "https://${GITHUB_API_HOST}/" "direct" "${family_hint}")"
    body="$(read_file_best_effort "${tmp}" 2> /dev/null || true)"
    safe_remove_temp_file "${tmp}"

    http="$(extract_field http_code "${meta}")"
    ctype="$(extract_field content_type "${meta}")"
    tls="$(extract_field ssl_verify_result "${meta}")"
    remote="$(extract_field remote_ip "${meta}")"
    time_total="$(extract_field time_total "${meta}")"
    latency_ms="$(float_ms "${time_total}")"

    if [[ "${http}" == "200" && "${ctype}" == *"application/json"* && "${tls}" == "0" ]] && github_api_root_body_is_shaped "${body}"; then
        score=80
        if ((latency_ms > 0 && latency_ms <= 500)); then score=$((score + 5)); fi
        printf 'ok|%s|%s|%s|%s
' "${remote:-unknown}" "${latency_ms:-0}" "${score}" "${meta}"
        return 0
    fi

    if root_http_is_degraded_reachable "${http}" "${tls}"; then
        score=65
        if ((latency_ms > 0 && latency_ms <= 500)); then score=$((score + 3)); fi
        printf 'degraded|%s|%s|%s|%s
' "${remote:-unknown}" "${latency_ms:-0}" "${score}" "${meta}"
        return 0
    fi

    printf 'fail|%s|%s|0|%s
' "${remote:-unknown}" "${latency_ms:-0}" "${meta}"
    return 1
}

probe_current_functionality_summary() {
    local profile="${FUNCTIONALITY_PROFILE}" path tmp meta body http ctype tls summary status
    summary=""
    status="ok"

    for path in /rate_limit /user; do
        tmp="$(make_temp_file github-api-current-capability /tmp)"
        [[ -n "${tmp}" ]] || {
            status="degraded"
            summary="${summary}${summary:+,}${path}:no-temp"
            continue
        }
        meta="$(curl_current_route "${tmp}" "https://${GITHUB_API_HOST}${path}" "direct" "auto")"
        body="$(read_file_best_effort "${tmp}" 2> /dev/null || true)"
        safe_remove_temp_file "${tmp}"
        http="$(extract_field http_code "${meta}")"
        ctype="$(extract_field content_type "${meta}")"
        tls="$(extract_field ssl_verify_result "${meta}")"

        case "${path}" in
            /rate_limit)
                if [[ "${http}" == "200" && "${ctype}" == *"application/json"* && "${tls}" == "0" ]] && printf '%s' "${body}" | grep -q 'resources'; then
                    summary="${summary}${summary:+,}rate:${http}"
                else
                    status="degraded"
                    summary="${summary}${summary:+,}rate:${http:-000}"
                fi
                ;;
            /user)
                if [[ ("${http}" == "200" || "${http}" == "401" || "${http}" == "403") && "${ctype}" == *"application/json"* && "${tls}" == "0" ]]; then
                    summary="${summary}${summary:+,}user:${http}"
                else
                    status="degraded"
                    summary="${summary}${summary:+,}user:${http:-000}"
                fi
                ;;
        esac
    done

    if [[ "${profile}" != "core" && "${COPILOT_TOKEN_SHAPED_PROBE}" == "true" ]]; then
        path="/copilot_internal/v2/token"
        tmp="$(make_temp_file github-api-current-copilot-token /tmp)"
        if [[ -n "${tmp}" ]]; then
            meta="$(curl_current_route "${tmp}" "https://${GITHUB_API_HOST}${path}" "direct" "auto")"
            body="$(read_file_best_effort "${tmp}" 2> /dev/null || true)"
            safe_remove_temp_file "${tmp}"
            http="$(extract_field http_code "${meta}")"
            ctype="$(extract_field content_type "${meta}")"
            tls="$(extract_field ssl_verify_result "${meta}")"
            if [[ ("${http}" == "200" || "${http}" == "401" || "${http}" == "403" || "${http}" == "404") && "${tls}" == "0" ]] \
                && { [[ "${ctype}" == *"application/json"* ]] || printf '%s' "${body}" | grep -q 'message\|documentation_url\|token'; }; then
                summary="${summary}${summary:+,}copilot_token:${http}"
            else
                status="degraded"
                summary="${summary}${summary:+,}copilot_token:${http:-000}"
            fi
        else
            status="degraded"
            summary="${summary}${summary:+,}copilot_token:no-temp"
        fi
    fi

    if [[ "${profile}" == "full" && "${META_SHAPED_PROBE}" == "true" ]]; then
        path="/meta"
        tmp="$(make_temp_file github-api-current-meta /tmp)"
        if [[ -n "${tmp}" ]]; then
            meta="$(curl_current_route "${tmp}" "https://${GITHUB_API_HOST}${path}" "direct" "auto")"
            body="$(read_file_best_effort "${tmp}" 2> /dev/null || true)"
            safe_remove_temp_file "${tmp}"
            http="$(extract_field http_code "${meta}")"
            ctype="$(extract_field content_type "${meta}")"
            tls="$(extract_field ssl_verify_result "${meta}")"
            if [[ "${http}" == "200" && "${ctype}" == *"application/json"* && "${tls}" == "0" ]] \
                && printf '%s' "${body}" | grep -q '"api"\|"hooks"\|"web"'; then
                summary="${summary}${summary:+,}meta:${http}"
            else
                status="degraded"
                summary="${summary}${summary:+,}meta:${http:-000}"
            fi
        else
            status="degraded"
            summary="${summary}${summary:+,}meta:no-temp"
        fi
    fi

    printf '%s|%s\n' "${status}" "${summary:-none}"
}

openssl_preflight_ok() {
    local ip="$1" host="${GITHUB_API_HOST}"
    [[ "${OPENSSL_PREFLIGHT}" == "true" ]] || return 0
    has_cmd openssl || return 0
    has_cmd timeout || return 0

    local connect_target="${ip}:443"
    if is_ipv6 "${ip}"; then connect_target="[${ip}]:443"; fi

    timeout "${OPENSSL_PREFLIGHT_TIMEOUT}" openssl s_client \
        -servername "${host}" \
        -connect "${connect_target}" \
        -verify_return_error \
        < /dev/null > /dev/null 2>&1
}

probe_github_api_candidate() {
    local ip
    local tmp_root tmp_rate tmp_user root_meta rate_meta user_meta root_body rate_body user_body
    local score reason state hist_delta hist_p95 hist_recent_failures hist_cooldown_remaining hist_recovery_remaining hist_reason
    ip="${1:-}"
    score=0
    reason=""

    if ! is_ip_candidate "${ip}"; then
        printf '%s|0|000|000|000|0||decision=candidate-rejected;invalid-ip;\n' "${ip}"
        return 0
    fi

    state="$(cache_candidate_state "${ip}")"
    IFS='|' read -r hist_delta hist_p95 hist_recent_failures hist_cooldown_remaining hist_recovery_remaining hist_reason <<< "${state}"
    if [[ "${hist_cooldown_remaining}" =~ ^[0-9]+$ && "${hist_cooldown_remaining}" -gt 0 ]]; then
        printf '%s|0|000|000|000|0||decision=candidate-suppressed;cooldown-active=%s;p95_latency_ms=%s;recent_failures=%s;recovery_remaining_seconds=%s;%s\n' \
            "${ip}" "${hist_cooldown_remaining}" "${hist_p95:-0}" "${hist_recent_failures:-0}" "${hist_recovery_remaining:-0}" "${hist_reason:-}"
        return 0
    fi

    if cache_recent_failure_blocked "${ip}"; then
        printf '%s|0|000|000|000|0||decision=candidate-suppressed;recent-failure-hard-block;p95_latency_ms=%s;recent_failures=%s;recovery_remaining_seconds=%s;%s\n' \
            "${ip}" "${hist_p95:-0}" "${hist_recent_failures:-0}" "${hist_recovery_remaining:-0}" "${hist_reason:-}"
        return 0
    fi

    if ! openssl_preflight_ok "${ip}"; then
        reason="${reason}decision=candidate-rejected;openssl-preflight-fail;"
        printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "${ip}" "0" "000" "000" "000" "0" "" "${reason}"
        return 0
    fi

    tmp_root="$(make_temp_file github-api-root /tmp)"
    [[ -n "${tmp_root}" ]] || {
        printf '%s|0|000|000|000|0||decision=candidate-rejected;no-temp-file;\n' "${ip}"
        return 0
    }
    root_meta="$(curl_candidate_route "${tmp_root}" "/" "${ip}")"
    log_debug "candidate=${ip} root_meta=${root_meta}"

    local root_http root_ctype root_time root_remote root_tls root_ms
    root_http="$(extract_field http_code "${root_meta}")"
    root_ctype="$(extract_field content_type "${root_meta}")"
    root_time="$(extract_field time_total "${root_meta}")"
    root_remote="$(extract_field remote_ip "${root_meta}")"
    root_tls="$(extract_field ssl_verify_result "${root_meta}")"
    root_ms="$(float_ms "${root_time}")"
    root_body="$(read_file_best_effort "${tmp_root}" 2> /dev/null || true)"
    safe_remove_temp_file "${tmp_root}"

    if [[ "${root_http}" == "200" && "${root_ctype}" == *"application/json"* && "${root_tls}" == "0" ]] \
        && github_api_root_body_is_shaped "${root_body}"; then
        score=$((score + 55))
        reason="${reason}root-api-ok;+55;root_reachability=ok;"
    elif root_http_is_degraded_reachable "${root_http}" "${root_tls}"; then
        # GitHub can emit 403/429 during primary or secondary rate limiting.
        # With TLS verified and a real HTTP response, the transport is reachable;
        # continue to capability probes instead of discarding a candidate solely
        # because the API root is rate-limited/forbidden.
        score=$((score + 40))
        reason="${reason}root-api-degraded-reachable(http=${root_http:-000},ctype=${root_ctype:-none},tls=${root_tls:-?});+40;root_reachability=degraded;"
    elif http_is_reachable "${root_http}" "${root_tls}" && github_api_json_content_type_is_plausible "${root_ctype}"; then
        score=$((score + 20))
        reason="${reason}root-api-unexpected-but-reachable(http=${root_http:-000},ctype=${root_ctype:-none},tls=${root_tls:-?});+20;root_reachability=unexpected-http;"
    else
        reason="${reason}decision=candidate-rejected;root-api-fail(http=${root_http:-000},ctype=${root_ctype:-none},tls=${root_tls:-?});root_reachability=failed;"
        printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "${ip}" "0" "${root_http:-000}" "000" "000" "${root_ms:-0}" "${root_remote:-}" "${reason}"
        return 0
    fi

    local rate_http rate_ctype rate_tls
    rate_http="000"
    tmp_rate="$(make_temp_file github-api-rate /tmp)"
    if [[ -n "${tmp_rate}" ]]; then
        rate_meta="$(curl_candidate_route "${tmp_rate}" "/rate_limit" "${ip}")"
        rate_http="$(extract_field http_code "${rate_meta}")"
        rate_ctype="$(extract_field content_type "${rate_meta}")"
        rate_tls="$(extract_field ssl_verify_result "${rate_meta}")"
        rate_body="$(read_file_best_effort "${tmp_rate}" 2> /dev/null || true)"
        safe_remove_temp_file "${tmp_rate}"

        if [[ "${rate_http}" == "200" && "${rate_ctype}" == *"application/json"* && "${rate_tls}" == "0" ]] \
            && printf '%s' "${rate_body}" | grep -q 'resources' \
            && printf '%s' "${rate_body}" | grep -q 'rate'; then
            score=$((score + 25))
            reason="${reason}rate-limit-ok;+25;"
        else
            reason="${reason}rate-limit-fail(http=${rate_http:-000},ctype=${rate_ctype:-none},tls=${rate_tls:-?});"
        fi
    else
        reason="${reason}rate-limit-fail(no-temp-file);"
    fi

    local user_http user_ctype user_tls
    user_http="000"
    tmp_user="$(make_temp_file github-api-user /tmp)"
    if [[ -n "${tmp_user}" ]]; then
        user_meta="$(curl_candidate_route "${tmp_user}" "/user" "${ip}")"
        user_http="$(extract_field http_code "${user_meta}")"
        user_ctype="$(extract_field content_type "${user_meta}")"
        user_tls="$(extract_field ssl_verify_result "${user_meta}")"
        user_body="$(read_file_best_effort "${tmp_user}" 2> /dev/null || true)"
        safe_remove_temp_file "${tmp_user}"

        if [[ ("${user_http}" == "200" || "${user_http}" == "401" || "${user_http}" == "403") && "${user_ctype}" == *"application/json"* && "${user_tls}" == "0" ]] \
            && { printf '%s' "${user_body}" | grep -q 'message\|login\|documentation_url' || [[ "${user_http}" == "403" ]]; }; then
            score=$((score + 15))
            reason="${reason}user-endpoint-shaped-ok;+15;"
        else
            reason="${reason}user-endpoint-fail(http=${user_http:-000},ctype=${user_ctype:-none},tls=${user_tls:-?});"
        fi
    else
        reason="${reason}user-endpoint-fail(no-temp-file);"
    fi

    local copilot_http copilot_ctype copilot_tls copilot_meta copilot_body tmp_copilot
    local meta_http meta_ctype meta_tls meta_meta meta_body tmp_meta capability_summary capability_status
    copilot_http="skipped"
    meta_http="skipped"
    capability_status="ok"
    capability_summary="root:${root_http:-000},rate:${rate_http:-000},user:${user_http:-000}"

    if [[ "${FUNCTIONALITY_PROFILE}" != "core" && "${COPILOT_TOKEN_SHAPED_PROBE}" == "true" ]]; then
        tmp_copilot="$(make_temp_file github-api-copilot-token /tmp)"
        if [[ -n "${tmp_copilot}" ]]; then
            copilot_meta="$(curl_candidate_route "${tmp_copilot}" "/copilot_internal/v2/token" "${ip}")"
            copilot_http="$(extract_field http_code "${copilot_meta}")"
            copilot_ctype="$(extract_field content_type "${copilot_meta}")"
            copilot_tls="$(extract_field ssl_verify_result "${copilot_meta}")"
            copilot_body="$(read_file_best_effort "${tmp_copilot}" 2> /dev/null || true)"
            safe_remove_temp_file "${tmp_copilot}"

            if [[ ("${copilot_http}" == "200" || "${copilot_http}" == "401" || "${copilot_http}" == "403" || "${copilot_http}" == "404") && "${copilot_tls}" == "0" ]] \
                && { [[ "${copilot_ctype}" == *"application/json"* ]] || printf '%s' "${copilot_body}" | grep -q 'message\|documentation_url\|token'; }; then
                score=$((score + 5))
                reason="${reason}copilot-token-shaped-ok;+5;copilot_token_http=${copilot_http};"
                capability_summary="${capability_summary},copilot_token:${copilot_http}"
            else
                capability_status="degraded"
                reason="${reason}copilot-token-shaped-fail(http=${copilot_http:-000},ctype=${copilot_ctype:-none},tls=${copilot_tls:-?});copilot_token_http=${copilot_http:-000};"
                capability_summary="${capability_summary},copilot_token:${copilot_http:-000}"
                if [[ "${FUNCTIONALITY_STRICT}" == "true" ]]; then
                    score=0
                    reason="${reason}decision=candidate-rejected;strict-copilot-token-shape-fail;"
                fi
            fi
        else
            capability_status="degraded"
            reason="${reason}copilot-token-shaped-fail(no-temp-file);copilot_token_http=000;"
            capability_summary="${capability_summary},copilot_token:000"
            if [[ "${FUNCTIONALITY_STRICT}" == "true" ]]; then
                score=0
                reason="${reason}decision=candidate-rejected;strict-copilot-token-no-temp-file;"
            fi
        fi
    fi

    if [[ "${FUNCTIONALITY_PROFILE}" == "full" && "${META_SHAPED_PROBE}" == "true" ]]; then
        tmp_meta="$(make_temp_file github-api-meta-shape /tmp)"
        if [[ -n "${tmp_meta}" ]]; then
            meta_meta="$(curl_candidate_route "${tmp_meta}" "/meta" "${ip}")"
            meta_http="$(extract_field http_code "${meta_meta}")"
            meta_ctype="$(extract_field content_type "${meta_meta}")"
            meta_tls="$(extract_field ssl_verify_result "${meta_meta}")"
            meta_body="$(read_file_best_effort "${tmp_meta}" 2> /dev/null || true)"
            safe_remove_temp_file "${tmp_meta}"

            if [[ "${meta_http}" == "200" && "${meta_ctype}" == *"application/json"* && "${meta_tls}" == "0" ]] \
                && printf '%s' "${meta_body}" | grep -q '"api"\|"hooks"\|"web"'; then
                score=$((score + 3))
                reason="${reason}meta-shaped-ok;+3;meta_http=${meta_http};"
                capability_summary="${capability_summary},meta:${meta_http}"
            else
                capability_status="degraded"
                reason="${reason}meta-shaped-fail(http=${meta_http:-000},ctype=${meta_ctype:-none},tls=${meta_tls:-?});meta_http=${meta_http:-000};"
                capability_summary="${capability_summary},meta:${meta_http:-000}"
                if [[ "${FUNCTIONALITY_STRICT}" == "true" ]]; then
                    score=0
                    reason="${reason}decision=candidate-rejected;strict-meta-shape-fail;"
                fi
            fi
        else
            capability_status="degraded"
            reason="${reason}meta-shaped-fail(no-temp-file);meta_http=000;"
            capability_summary="${capability_summary},meta:000"
            if [[ "${FUNCTIONALITY_STRICT}" == "true" ]]; then
                score=0
                reason="${reason}decision=candidate-rejected;strict-meta-no-temp-file;"
            fi
        fi
    fi

    reason="${reason}capability_status=${capability_status};capabilities=${capability_summary};"

    if [[ -n "${root_ms}" ]]; then
        if ((root_ms > 0 && root_ms <= 500)); then
            score=$((score + 5))
            reason="${reason}current-latency<=500ms;+5;"
        elif ((root_ms > 500 && root_ms <= 1500)); then
            score=$((score + 2))
            reason="${reason}current-latency<=1500ms;+2;"
        else
            reason="${reason}current-latency-slow-or-missing;"
        fi
    fi

    if [[ "${hist_delta}" =~ ^-?[0-9]+$ && "${hist_delta}" != "0" ]]; then
        score=$((score + hist_delta))
    fi
    reason="${reason}history-delta=${hist_delta:-0};p95_latency_ms=${hist_p95:-0};recent_failures=${hist_recent_failures:-0};recovery_remaining_seconds=${hist_recovery_remaining:-0};${hist_reason:-}"

    if ((score < 0)); then score=0; fi

    if ((score >= MIN_SCORE)); then
        reason="${reason}decision=candidate-valid;"
    else
        reason="${reason}decision=candidate-below-min-score;"
    fi

    printf '%s|%s|%s|%s|%s|%s|%s|%s\n' \
        "${ip}" "${score}" "${root_http:-000}" "${rate_http:-000}" "${user_http:-000}" "${root_ms:-0}" "${root_remote:-}" "${reason}"
}

# -----------------------------------------------------------------------------
# GitHub /meta candidate discovery
# -----------------------------------------------------------------------------
github_meta_candidates() {
    [[ "${ENABLE_META_CANDIDATES}" == "true" ]] || return 0
    [[ "${GITHUB_API_HOST}" == "api.github.com" || "${ALLOW_CUSTOM_HOST}" == "true" ]] || return 0
    has_cmd curl || return 0

    local tmp curl_rc
    tmp="$(make_temp_file github-api-meta /tmp)"
    [[ -n "${tmp}" ]] || return 0

    LC_ALL=C run_with_timeout "${META_CANDIDATE_TIMEOUT}" curl -sS \
        --noproxy '*' \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${META_CANDIDATE_TIMEOUT}" \
        -H 'Accept: application/vnd.github+json' \
        -H "X-GitHub-Api-Version: ${GITHUB_API_VERSION}" \
        -o "${tmp}" \
        "https://${GITHUB_API_HOST}/meta" > /dev/null 2> /dev/null
    curl_rc=$?

    if [[ "${curl_rc}" -ne 0 || ! -s "${tmp}" ]]; then
        append_report "meta_candidates=unavailable rc=${curl_rc}"
        safe_remove_temp_file "${tmp}"
        return 0
    fi

    if has_cmd python3; then
        python3 - "${tmp}" << 'PY' 2> /dev/null
import json, sys, ipaddress
try:
    with open(sys.argv[1], 'r', encoding='utf-8') as handle:
        data = json.load(handle)
except Exception:
    sys.exit(0)
for value in data.get('api', []):
    try:
        network = ipaddress.ip_network(value, strict=False)
    except Exception:
        continue
    # /meta is an allowlist source, not a routing oracle. Emit only bounded
    # representative candidates and let the semantic HTTPS probes decide.
    if network.version == 4:
        if network.prefixlen == 32:
            print(network.network_address)
            continue
        hosts = list(network.hosts()) if network.num_addresses <= 32 else []
        if hosts:
            for ip in hosts[:8]:
                print(ip)
            continue
        if network.num_addresses > 2:
            # Avoid network/broadcast and avoid noisy .1/.254 style edge hosts.
            # /meta provides GitHub-owned ranges, not guaranteed service IPs;
            # these are bounded representatives that semantic HTTPS probes must
            # still validate before use.
            emitted = set()
            offsets = (5, 6, 10, 20)
            for offset in offsets:
                try:
                    candidate = network.network_address + offset
                    if candidate in network and candidate not in emitted:
                        print(candidate)
                        emitted.add(candidate)
                except Exception:
                    pass
            for offset in offsets:
                try:
                    candidate = network.broadcast_address - offset
                    if candidate in network and candidate not in emitted:
                        print(candidate)
                        emitted.add(candidate)
                except Exception:
                    pass
    elif network.version == 6 and network.prefixlen == 128:
        print(network.network_address)
PY
        safe_remove_temp_file "${tmp}"
        return 0
    fi

    # Fallback parser for simple quoted IP/CIDR tokens inside the "api" array.
    grep -Eo '"[0-9A-Fa-f:.]+(/[0-9]+)?"' "${tmp}" 2> /dev/null \
        | tr -d '"' \
        | sed 's#/32$##' 2> /dev/null || true
    safe_remove_temp_file "${tmp}"
}

# -----------------------------------------------------------------------------
# Candidate discovery
# -----------------------------------------------------------------------------
collect_github_api_candidates() {
    local host="${GITHUB_API_HOST}" resolver
    local -a resolvers=()
    read -r -a resolvers <<< "${RESOLVERS}"

    {
        # Prefer observed/current resolver paths before coarse /meta CIDR samples.
        # /meta remains useful as a bounded fallback signal, but it is not a
        # routing oracle and should not crowd out DNS-observed candidates.
        cache_candidates || true

        awk -v h="${host}" '$0 !~ /^#/ { for (i=2; i<=NF; i++) if ($i == h) print $1 }' /etc/hosts 2> /dev/null || true

        if has_cmd getent; then
            if [[ "${ENABLE_IPV6}" == "true" ]]; then
                getent ahosts "${host}" 2> /dev/null | awk '{print $1}' || true
            else
                getent ahostsv4 "${host}" 2> /dev/null | awk '{print $1}' || true
            fi
        fi

        if has_cmd dig; then
            for resolver in "${resolvers[@]}"; do
                is_resolver_ip "${resolver}" || continue
                dig +time=1 +tries=1 @"${resolver}" "${host}" +short A 2> /dev/null || true
                if [[ "${ENABLE_IPV6}" == "true" ]]; then
                    dig +time=1 +tries=1 @"${resolver}" "${host}" +short AAAA 2> /dev/null || true
                fi
            done
        else
            log_warn "dig não encontrado; usando cache/getent/seeds."
        fi

        split_words_to_lines "${SEED_CANDIDATES}"

        github_meta_candidates || true
    } | while IFS= read -r ip; do
        is_ip_candidate "${ip}" && printf '%s\n' "${ip}"
    done | unique_ordered_trim "${MAX_CANDIDATES}"
}

# -----------------------------------------------------------------------------
# Optional auth-shaped probes
# -----------------------------------------------------------------------------
get_github_token_best_effort() {
    if [[ -n "${GH_TOKEN:-}" ]]; then
        printf '%s' "${GH_TOKEN}"
        return 0
    fi
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        printf '%s' "${GITHUB_TOKEN}"
        return 0
    fi
    if has_cmd gh; then run_with_timeout "${AUTH_TOKEN_TIMEOUT_SECONDS}" gh auth token 2> /dev/null || true; fi
}

probe_github_api_auth_optional() {
    local ip="$1" host="${GITHUB_API_HOST}"
    if [[ "${ENABLE_AUTH_PROBE}" != "true" && "${ENABLE_COPILOT_INTERNAL_AUTH_PROBE}" != "true" ]]; then return 0; fi

    local token resolve_value flag
    token="$(get_github_token_best_effort)"
    if [[ -z "${token}" ]]; then
        log_warn "auth probe: token indisponível; probes autenticados ignorados."
        return 0
    fi

    resolve_value="$(curl_resolve_value "${host}" "${ip}")"
    flag="$(curl_ip_flag "${ip}")"

    if [[ "${ENABLE_AUTH_PROBE}" == "true" ]]; then
        local user_meta user_http user_tls
        local -a curl_args=()
        [[ -n "${flag}" ]] && curl_args+=("${flag}")
        curl_args+=(--noproxy '*')
        user_meta="$(LC_ALL=C curl "${curl_args[@]}" -sS \
            --connect-timeout "${CONNECT_TIMEOUT}" \
            --max-time "${MAX_TIME}" \
            --resolve "${resolve_value}" \
            -H "Authorization: Bearer ${token}" \
            -H 'Accept: application/vnd.github+json' \
            -H "X-GitHub-Api-Version: ${GITHUB_API_VERSION}" \
            -o /dev/null \
            -w 'http_code=%{http_code}|ssl_verify_result=%{ssl_verify_result}' \
            "https://${host}/user" 2> /dev/null || true)"
        user_http="$(extract_field http_code "${user_meta}")"
        user_tls="$(extract_field ssl_verify_result "${user_meta}")"
        if [[ "${user_http}" == "200" && "${user_tls}" == "0" ]]; then
            log_ok "auth probe OK: /user autenticado via ${ip} → HTTP 200."
        else
            log_warn "auth probe não OK: /user autenticado via ${ip} → HTTP ${user_http:-000}, tls=${user_tls:-?}."
        fi
    fi

    if [[ "${ENABLE_COPILOT_INTERNAL_AUTH_PROBE}" == "true" ]]; then
        local cop_meta cop_http cop_tls
        local -a curl_args=()
        [[ -n "${flag}" ]] && curl_args+=("${flag}")
        curl_args+=(--noproxy '*')
        cop_meta="$(LC_ALL=C curl "${curl_args[@]}" -sS \
            --connect-timeout "${CONNECT_TIMEOUT}" \
            --max-time "${MAX_TIME}" \
            --resolve "${resolve_value}" \
            -H "Authorization: Bearer ${token}" \
            -H 'Accept: application/json' \
            -H "X-GitHub-Api-Version: ${GITHUB_API_VERSION}" \
            -o /dev/null \
            -w 'http_code=%{http_code}|ssl_verify_result=%{ssl_verify_result}' \
            "https://${host}/copilot_internal/v2/token" 2> /dev/null || true)"
        cop_http="$(extract_field http_code "${cop_meta}")"
        cop_tls="$(extract_field ssl_verify_result "${cop_meta}")"
        if [[ "${cop_tls}" == "0" && ("${cop_http}" == "200" || "${cop_http}" == "401" || "${cop_http}" == "403") ]]; then
            log_ok "copilot_internal shaped probe OK: /copilot_internal/v2/token via ${ip} → HTTP ${cop_http}."
        else
            log_warn "copilot_internal shaped probe não OK: HTTP ${cop_http:-000}, tls=${cop_tls:-?}."
        fi
    fi
}

# -----------------------------------------------------------------------------
# /etc/hosts apply / restore / verify
# -----------------------------------------------------------------------------
strip_managed_hosts_block() {
    local host="${GITHUB_API_HOST}"
    awk -v h="${host}" '
        BEGIN { skip=0 }
        $0 ~ /^# >>> devcontainer-github-api-route-fix/ { skip=1; next }
        $0 ~ /^# <<< devcontainer-github-api-route-fix/ { skip=0; next }
        skip == 1 { next }
        {
          found=0
          for (i=2; i<=NF; i++) if ($i == h) found=1
          if (found == 0) print $0
        }
    ' /etc/hosts 2> /dev/null
}

restore_hosts_from_backup() {
    local backup_file="$1"
    [[ -r "${backup_file}" ]] || return 1
    if safe_sudo tee /etc/hosts < "${backup_file}" > /dev/null 2>&1; then
        log_info "rollback de /etc/hosts aplicado a partir de ${backup_file}."
        append_report "rollback=ok backup=${backup_file}"
        return 0
    fi
    log_warn "rollback de /etc/hosts falhou; backup disponível em ${backup_file}."
    append_report "rollback=failed backup=${backup_file}"
    return 1
}

apply_hosts_locked_body() {
    local best_ip="$1" backup_file="${2:-}" host="${GITHUB_API_HOST}"
    local tmp_hosts backup_dir
    tmp_hosts="$(make_temp_file hosts.github-api /tmp)"
    [[ -n "${tmp_hosts}" ]] || {
        log_warn "falha ao criar arquivo temporário para /etc/hosts."
        return 1
    }

    backup_dir="${DEVCONTAINER_GITHUB_API_HOSTS_BACKUP_DIR:-/tmp}"
    mkdir -p "${backup_dir}" 2> /dev/null || backup_dir="/tmp"
    if [[ -z "${backup_file}" ]]; then
        backup_file="$(mktemp "${backup_dir%/}/hosts.pre-github-api-route-fix.XXXXXX" 2> /dev/null || true)"
    fi
    if [[ -z "${backup_file}" ]]; then
        log_warn "falha ao criar backup temporário de /etc/hosts; abortando mutação."
        rm -f "${tmp_hosts}" 2> /dev/null || true
        append_report "hosts_backup=failed stage=mktemp"
        return 1
    fi
    if ! cp /etc/hosts "${backup_file}" 2> /dev/null; then
        log_warn "falha ao copiar /etc/hosts para backup; abortando mutação."
        rm -f "${tmp_hosts}" "${backup_file}" 2> /dev/null || true
        append_report "hosts_backup=failed stage=copy"
        return 1
    fi
    chmod 0600 "${backup_file}" 2> /dev/null || true

    strip_managed_hosts_block > "${tmp_hosts}" 2> /dev/null || {
        log_warn "falha ao preparar novo conteúdo de /etc/hosts."
        rm -f "${tmp_hosts}" 2> /dev/null || true
        return 1
    }

    {
        printf '\n# >>> devcontainer-github-api-route-fix managed by %s v%s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}"
        printf '# reason: validated semantic GitHub API route; default ISP/DNS route may be broken\n'
        printf '# generated_at: %s\n' "$(ts)"
        printf '%s %s\n' "${best_ip}" "${host}"
        printf '# <<< devcontainer-github-api-route-fix\n'
    } >> "${tmp_hosts}"

    if ! safe_sudo tee /etc/hosts < "${tmp_hosts}" > /dev/null 2>&1; then
        log_warn "falha ao aplicar /etc/hosts via tee (sem sudo -n/root ou read-only?)."
        rm -f "${tmp_hosts}" 2> /dev/null || true
        return 1
    fi

    rm -f "${tmp_hosts}" 2> /dev/null || true
    log_info "backup best-effort de /etc/hosts em ${backup_file}."
    append_report "hosts_backup=${backup_file}"
    log_ok "override aplicado: ${host} → ${best_ip}"
    return 0
}

apply_github_api_hosts_override() {
    local best_ip="$1" backup_file="${2:-}"
    local lock_dir
    lock_dir="$(dirname "${HOSTS_LOCK_FILE}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${lock_dir}" 2> /dev/null || true

    if has_cmd flock; then
        (
            flock -x -w "${HOSTS_LOCK_WAIT_SECONDS}" 9 || exit 98
            apply_hosts_locked_body "${best_ip}" "${backup_file}"
        ) 9> "${HOSTS_LOCK_FILE}"
        return $?
    fi

    apply_hosts_locked_body "${best_ip}" "${backup_file}"
}

verify_github_api_hosts_override() {
    local expected_ip="$1" host="${GITHUB_API_HOST}" resolved result state remote latency score meta
    if [[ "${ENABLE_IPV6}" == "true" ]]; then
        resolved="$(getent ahosts "${host}" 2> /dev/null | awk 'NR==1{print $1}' || true)"
    else
        resolved="$(getent ahostsv4 "${host}" 2> /dev/null | awk 'NR==1{print $1}' || true)"
    fi
    log_info "verify: getent ${host} → ${resolved:-<none>}"

    result="$(probe_github_api_current_route)"
    IFS='|' read -r state remote latency score meta <<< "${result}"

    if [[ "${state}" == "ok" ]]; then
        log_ok "verify OK: ${host} → IP ${remote:-unknown} | latency=${latency:-0}ms | score=${score:-0}"
        if [[ -n "${expected_ip}" && "${remote}" != "${expected_ip}" ]]; then
            log_warn "verify: remote_ip=${remote}, esperado=${expected_ip}; pode haver cache/proxy."
            if [[ "${STRICT_VERIFY_EXPECTED_IP}" == "true" ]]; then
                append_report "verify=strict-mismatch expected=${expected_ip} remote=${remote:-unknown}"
                return 1
            fi
        fi
        return 0
    fi

    log_warn "verify FALHOU: ${host} → IP ${remote:-unknown}; meta=${meta:-none}"
    return 1
}

# -----------------------------------------------------------------------------
# Selection / hysteresis
# -----------------------------------------------------------------------------
should_switch_from_current() {
    local current_ip="$1" current_score="$2" current_latency="$3" best_ip="$4" best_score="$5" best_latency="$6"

    [[ "${FORCE_RESELECT}" == "true" ]] && return 0
    [[ -z "${current_ip}" || "${current_ip}" == "unknown" ]] && return 0
    [[ "${current_ip}" == "${best_ip}" ]] && return 1

    is_nonnegative_int "${current_score}" || current_score=0
    is_nonnegative_int "${current_latency}" || current_latency=0
    is_nonnegative_int "${best_score}" || best_score=0
    is_nonnegative_int "${best_latency}" || best_latency=999999

    if ((current_score < MIN_SCORE)); then return 0; fi
    if ((best_score >= current_score + HYSTERESIS_SCORE_MARGIN)); then return 0; fi

    if ((best_score >= current_score && current_latency > 0 && best_latency > 0)); then
        local threshold
        threshold=$((current_latency * HYSTERESIS_LATENCY_RATIO_PERCENT / 100))
        if ((best_latency < threshold)); then return 0; fi
    fi

    return 1
}

probe_candidates_parallel() {
    local candidates="$1"
    local tmp_dir pid ip tmp_file count
    local -a pids=() files=() ips=()
    count=0

    tmp_dir="$(make_temp_dir github-api-probes "${PROBE_TMP_DIR}")"
    if [[ -z "${tmp_dir}" || ! -d "${tmp_dir}" ]]; then return 1; fi

    while IFS= read -r ip; do
        [[ -z "${ip}" ]] && continue
        count=$((count + 1))
        tmp_file="${tmp_dir}/probe.${count}.$(printf '%s' "${ip}" | tr -c 'A-Za-z0-9_' '_').out"
        probe_github_api_candidate "${ip}" > "${tmp_file}" 2> "${tmp_file}.err" &
        pid=$!
        pids+=("${pid}")
        files+=("${tmp_file}")
        ips+=("${ip}")
    done <<< "${candidates}"

    for pid in "${pids[@]}"; do wait "${pid}" 2> /dev/null || true; done

    local index=0
    while ((index < ${#files[@]})); do
        if [[ -s "${files[index]}" ]]; then
            cat "${files[index]}"
        else
            printf '%s|0|000|000|000|0||probe-no-output;\n' "${ips[index]}"
        fi
        index=$((index + 1))
    done

    rm -rf "${tmp_dir}" 2> /dev/null || true
    return 0
}

probe_candidates_sequential() {
    local candidates="$1" ip
    while IFS= read -r ip; do
        [[ -z "${ip}" ]] && continue
        probe_github_api_candidate "${ip}"
    done <<< "${candidates}"
}

update_cache_from_record() {
    local record="$1" selected_ip="$2" ip score root_http rate_http user_http latency_ms remote reason ok selected
    IFS='|' read -r ip score root_http rate_http user_http latency_ms remote reason <<< "${record}"
    case "${reason}" in
        *decision=candidate-suppressed*)
            append_report "cache_update=skipped ip=${ip} reason=suppressed-candidate"
            return 0
            ;;
    esac
    ok="false"
    selected="false"
    if is_nonnegative_int "${score}" && ((score >= MIN_SCORE)); then ok="true"; fi
    if [[ -n "${selected_ip}" && "${ip}" == "${selected_ip}" ]]; then selected="true"; fi
    cache_update "${ip}" "${ok}" "${score:-0}" "${latency_ms:-0}" "${selected}"
}

update_cache_from_records() {
    local records="$1" selected_ip="${2:-}" record
    while IFS= read -r record; do
        [[ -n "${record}" ]] && update_cache_from_record "${record}" "${selected_ip}"
    done <<< "${records}"
}

select_and_apply_route() {
    write_report_header
    write_metrics_header
    write_status "running"
    prune_cache || true

    if ! is_safe_hostname "${GITHUB_API_HOST}"; then
        log_warn "host inválido/não seguro: ${GITHUB_API_HOST}"
        append_report "result=invalid-host host=${GITHUB_API_HOST}"
        write_summary "failed" "" "" "" "" "" "" "decision=fail;cause=invalid-host"
        return 1
    fi

    if [[ "${GITHUB_API_HOST}" != "api.github.com" && "${ALLOW_CUSTOM_HOST}" != "true" ]]; then
        log_warn "host customizado bloqueado por segurança: ${GITHUB_API_HOST}; defina DEVCONTAINER_GITHUB_API_ALLOW_CUSTOM_HOST=true para permitir."
        append_report "result=custom-host-not-allowed host=${GITHUB_API_HOST}"
        write_summary "failed" "" "" "" "" "" "" "decision=fail;cause=custom-host-not-allowed"
        return 1
    fi

    if ! has_cmd curl; then
        log_warn "curl não encontrado; não é possível validar rota."
        append_report "result=no-curl"
        write_summary "failed" "" "" "" "" "" "" "decision=fail;cause=no-curl"
        return 1
    fi

    ensure_cache_file || true

    if has_proxy_env && [[ "${PROXY_MODE}" != "direct" ]]; then
        if probe_proxy_route_if_configured; then
            set_summary_functionality_manual "proxy-root-ok" "root:200,transport:proxy"
            write_summary "ok" "${PROXY_ROUTE_REMOTE:-proxy}" "" "${PROXY_ROUTE_LATENCY_MS:-}" "${PROXY_ROUTE_REMOTE:-proxy}" "" "${PROXY_ROUTE_LATENCY_MS:-}" "decision=keep;cause=proxy-route-ok"
            return 0
        fi
        if [[ "${PROXY_MODE}" == "respect" ]]; then
            write_summary "failed" "" "" "" "" "" "" "decision=fail;cause=proxy-route-failed-respect-mode"
            return 1
        fi
    fi

    log_info "avaliando rota direta atual para ${GITHUB_API_HOST}."
    local current_result current_state current_remote current_latency current_score current_meta
    current_result="$(probe_github_api_current_route)"
    IFS='|' read -r current_state current_remote current_latency current_score current_meta <<< "${current_result}"
    append_report "current_route_state=${current_state} current_remote=${current_remote} current_latency_ms=${current_latency} current_score=${current_score} current_meta=${current_meta}"

    local current_capability_result current_capability_status current_capability_details current_root_http current_root_tls
    current_root_http="$(extract_field http_code "${current_meta}")"
    current_root_tls="$(extract_field ssl_verify_result "${current_meta}")"
    if [[ "${current_state}" == "ok" ]]; then
        current_capability_result="$(probe_current_functionality_summary)"
        IFS='|' read -r current_capability_status current_capability_details <<< "${current_capability_result}"
        set_summary_functionality_manual "${current_capability_status}" "root:200,${current_capability_details}"
        append_report "current_functionality status=${current_capability_status} details=root:200,${current_capability_details}"
    elif root_http_is_degraded_reachable "${current_root_http}" "${current_root_tls}"; then
        current_capability_result="$(probe_current_functionality_summary)"
        IFS='|' read -r current_capability_status current_capability_details <<< "${current_capability_result}"
        if [[ "${current_capability_status}" == "ok" ]]; then
            current_state="ok"
            current_score="85"
            set_summary_functionality_manual "ok" "root:${current_root_http},${current_capability_details},root_degraded_reachable:true"
            append_report "current_functionality status=ok details=root:${current_root_http},${current_capability_details} current_root_degraded_reachable=true"
        else
            set_summary_functionality_manual "degraded" "root:${current_root_http},${current_capability_details},root_degraded_reachable:true"
            append_report "current_functionality status=degraded details=root:${current_root_http},${current_capability_details} current_root_degraded_reachable=true"
        fi
    else
        set_summary_functionality_manual "failed" "root:${current_root_http:-failed}"
    fi

    if [[ "${current_state}" == "ok" && "${OPTIMIZE_WHEN_CURRENT_OK}" != "true" ]]; then
        log_ok "rota atual já é funcional (${GITHUB_API_HOST} → ${current_remote}, ${current_latency}ms); otimização desabilitada."
        append_report "result=current-ok-no-optimization selected=${current_remote} score=${current_score}"
        write_summary "ok" "${current_remote}" "${current_score}" "${current_latency}" "${current_remote}" "${current_score}" "${current_latency}" "decision=keep-current;cause=current-ok-no-optimization"
        return 0
    fi

    if [[ "${current_state}" == "ok" ]]; then
        log_ok "rota atual funcional (${GITHUB_API_HOST} → ${current_remote}, ${current_latency}ms); avaliando alternativas com histerese."
    else
        log_warn "rota atual NÃO funcional (${GITHUB_API_HOST} → ${current_remote:-unknown}); buscando alternativa validada."
    fi

    local candidates
    candidates="$(collect_github_api_candidates)"
    if [[ -z "${candidates}" ]]; then
        if [[ "${current_state}" == "ok" ]]; then
            log_ok "nenhum candidato coletado, mas rota atual está funcional; mantendo ${current_remote}."
            append_report "result=current-kept-no-candidates current=${current_remote} current_score=${current_score}"
            write_summary "ok" "${current_remote}" "${current_score}" "${current_latency}" "${current_remote}" "${current_score}" "${current_latency}" "decision=keep-current;cause=no-candidates;current-valid=true"
            return 0
        fi
        log_warn "nenhum candidato coletado."
        append_report "result=no-candidates"
        write_summary "failed" "" "" "" "${current_remote}" "${current_score}" "${current_latency}" "decision=fail;cause=no-candidates;current-valid=false"
        return 1
    fi

    log_info "candidatos coletados: $(printf '%s' "${candidates}" | tr '\n' ' ')"
    append_report "candidates=$(printf '%s' "${candidates}" | tr '\n' ' ')"

    local all_records=""
    if [[ "${PARALLEL_PROBES}" == "true" ]]; then
        all_records="$(probe_candidates_parallel "${candidates}")"
        if [[ -z "${all_records}" ]]; then
            log_warn "probes paralelos não produziram resultado; usando fallback sequencial."
            all_records="$(probe_candidates_sequential "${candidates}")"
        fi
    else
        all_records="$(probe_candidates_sequential "${candidates}")"
    fi

    local best_ip="" best_score=-1 best_latency=999999 best_record=""
    local current_full_score="" current_full_latency=""
    local record ip score root_http rate_http user_http latency_ms remote reason record_p95 record_recent_failures record_cooldown_remaining record_recovery_remaining best_reason

    while IFS= read -r record; do
        [[ -z "${record}" ]] && continue
        IFS='|' read -r ip score root_http rate_http user_http latency_ms remote reason <<< "${record}"

        log_info "candidate ${ip}: score=${score}; root=${root_http}; rate=${rate_http}; user=${user_http}; latency=${latency_ms}ms; remote=${remote:-?}; ${reason}"
        append_report "candidate=${ip} score=${score} root=${root_http} rate=${rate_http} user=${user_http} latency_ms=${latency_ms} remote=${remote} reason=${reason}"
        record_p95="$(extract_reason_field p95_latency_ms "${reason}")"
        record_recent_failures="$(extract_reason_field recent_failures "${reason}")"
        record_cooldown_remaining="$(extract_reason_field cooldown-active "${reason}")"
        record_recovery_remaining="$(extract_reason_field recovery_remaining_seconds "${reason}")"
        append_candidate_metric "${ip}" "${score}" "${root_http}" "${rate_http}" "${user_http}" "${latency_ms}" "${remote}" "${reason}" "false" "${record_p95:-unknown}" "${record_recent_failures:-0}" "${record_cooldown_remaining:-0}" "${record_recovery_remaining:-0}"

        if [[ "${current_state}" == "ok" && "${ip}" == "${current_remote}" ]]; then
            current_full_score="${score}"
            current_full_latency="${latency_ms}"
        fi

        if is_nonnegative_int "${score}"; then
            is_nonnegative_int "${latency_ms}" || latency_ms=999999
            if ((score > best_score)) || { ((score == best_score)) && ((latency_ms > 0 && latency_ms < best_latency)); }; then
                best_score="${score}"
                best_latency="${latency_ms:-999999}"
                best_ip="${ip}"
                best_record="${record}"
            fi
        fi
    done <<< "${all_records}"

    if [[ -z "${best_ip}" || "${best_score}" -lt "${MIN_SCORE}" ]]; then
        if [[ "${current_state}" == "ok" ]]; then
            log_ok "nenhum candidato superou o score mínimo, mas rota atual está funcional; mantendo ${current_remote}."
            append_report "result=current-kept-no-valid-candidate current=${current_remote} current_score=${current_score} best_ip=${best_ip:-none} best_score=${best_score} min_score=${MIN_SCORE}"
            update_cache_from_records "${all_records}" "${current_remote}"
            write_summary "ok" "${current_remote}" "${current_score}" "${current_latency}" "${current_remote}" "${current_score}" "${current_latency}" "decision=keep-current;cause=no-valid-candidate;current-valid=true"
            return 0
        fi
        log_warn "nenhum candidato atingiu score mínimo ${MIN_SCORE}; melhor=${best_ip:-none}, score=${best_score}."
        append_report "result=no-valid-candidate best_ip=${best_ip:-none} best_score=${best_score} min_score=${MIN_SCORE}"
        update_cache_from_records "${all_records}" ""
        if [[ -n "${best_record}" ]]; then
            best_reason="${best_record##*|}"
            set_summary_functionality_from_reason "${best_reason}"
        fi
        write_summary "failed" "${best_ip:-}" "${best_score}" "${best_latency}" "${current_remote}" "${current_score}" "${current_latency}" "decision=fail;cause=no-valid-candidate"
        return 1
    fi

    if [[ "${current_state}" == "ok" ]]; then
        if is_nonnegative_int "${current_full_score:-}"; then current_score="${current_full_score}"; fi
        if is_nonnegative_int "${current_full_latency:-}"; then current_latency="${current_full_latency}"; fi

        if should_switch_from_current "${current_remote}" "${current_score}" "${current_latency}" "${best_ip}" "${best_score}" "${best_latency}"; then
            log_info "histerese permitiu troca: atual=${current_remote}/${current_score}/${current_latency}ms → novo=${best_ip}/${best_score}/${best_latency}ms."
        else
            log_ok "mantendo rota atual por estabilidade: atual=${current_remote}/${current_score}/${current_latency}ms; melhor=${best_ip}/${best_score}/${best_latency}ms."
            append_report "result=current-kept current=${current_remote} current_score=${current_score} best_ip=${best_ip} best_score=${best_score}"
            update_cache_from_records "${all_records}" "${current_remote}"
            write_summary "ok" "${current_remote}" "${current_score}" "${current_latency}" "${current_remote}" "${current_score}" "${current_latency}" "decision=keep-current;cause=hysteresis"
            return 0
        fi
    fi

    log_ok "escolhido ${best_ip} com score=${best_score}, latency=${best_latency}ms."
    append_report "selected=${best_ip} selected_score=${best_score} selected_record=${best_record}"
    IFS='|' read -r ip score root_http rate_http user_http latency_ms remote reason <<< "${best_record}"
    set_summary_functionality_from_reason "${reason}"
    record_p95="$(extract_reason_field p95_latency_ms "${reason}")"
    record_recent_failures="$(extract_reason_field recent_failures "${reason}")"
    record_cooldown_remaining="$(extract_reason_field cooldown-active "${reason}")"
    record_recovery_remaining="$(extract_reason_field recovery_remaining_seconds "${reason}")"
    append_candidate_metric "${ip}" "${score}" "${root_http}" "${rate_http}" "${user_http}" "${latency_ms}" "${remote}" "${reason}" "true" "${record_p95:-unknown}" "${record_recent_failures:-0}" "${record_cooldown_remaining:-0}" "${record_recovery_remaining:-0}"

    if [[ "${DRY_RUN}" == "true" || "${ACTION}" == "probe" ]]; then
        log_ok "dry-run ativo: candidato validado, mas /etc/hosts não será alterado."
        append_report "result=dry-run selected=${best_ip} score=${best_score}"
        update_cache_from_records "${all_records}" ""
        write_summary "ok" "${best_ip}" "${best_score}" "${best_latency}" "${current_remote}" "${current_score}" "${current_latency}" "decision=probe-only;cause=validated-candidate"
        return 0
    fi

    local backup_file backup_dir
    backup_dir="${DEVCONTAINER_GITHUB_API_HOSTS_BACKUP_DIR:-/tmp}"
    mkdir -p "${backup_dir}" 2> /dev/null || backup_dir="/tmp"
    backup_file="$(mktemp "${backup_dir%/}/hosts.pre-github-api-route-fix.XXXXXX" 2> /dev/null || true)"
    if [[ -z "${backup_file}" ]]; then
        log_warn "falha ao criar backup temporário de /etc/hosts; não aplicando override."
        append_report "result=backup-mktemp-failed selected=${best_ip}"
        update_cache_from_records "${all_records}" ""
        write_summary "failed" "${best_ip}" "${best_score}" "${best_latency}" "${current_remote}" "${current_score}" "${current_latency}" "decision=fail;cause=hosts-backup-mktemp-failed"
        return 1
    fi

    apply_github_api_hosts_override "${best_ip}" "${backup_file}"
    local apply_rc=$?
    if [[ "${apply_rc}" -ne 0 ]]; then
        append_report "result=apply-failed selected=${best_ip}"
        update_cache_from_records "${all_records}" ""
        write_summary "failed" "${best_ip}" "${best_score}" "${best_latency}" "${current_remote}" "${current_score}" "${current_latency}" "decision=fail;cause=hosts-apply-failed"
        return 1
    fi

    if ! verify_github_api_hosts_override "${best_ip}"; then
        append_report "result=verify-failed selected=${best_ip}"
        if [[ "${ROLLBACK_ON_VERIFY_FAILURE}" == "true" && -n "${backup_file}" ]]; then
            restore_hosts_from_backup "${backup_file}" || true
        fi
        update_cache_from_records "${all_records}" ""
        write_summary "failed" "${best_ip}" "${best_score}" "${best_latency}" "${current_remote}" "${current_score}" "${current_latency}" "decision=fail;cause=post-apply-verify-failed"
        return 1
    fi

    update_cache_from_records "${all_records}" "${best_ip}"
    probe_github_api_auth_optional "${best_ip}" || true
    append_report "result=ok selected=${best_ip} score=${best_score}"
    write_summary "ok" "${best_ip}" "${best_score}" "${best_latency}" "${current_remote}" "${current_score}" "${current_latency}" "decision=apply;cause=validated-candidate"
    return 0
}

# -----------------------------------------------------------------------------
# Long-running benchmark / recommendation helpers (non-mutating)
# -----------------------------------------------------------------------------
tsv_safe() {
    printf '%s' "${1:-}" | tr '\t\n\r' '   '
}

extract_capability_http() {
    local key details
    key="${1:-}"
    details="${2:-}"
    [[ -n "${key}" ]] || return 0
    printf '%s' "${details}" | tr ',' '\n' | awk -F: -v k="${key}" '$1 == k {print $2; exit}' 2> /dev/null
}

write_benchmark_header() {
    ensure_parent_dir "${GITHUB_ROUTE_BENCHMARK_FILE}"
    printf 'timestamp\tsample_index\tsource\tip\tscore\troot_http\trate_http\tuser_http\tcopilot_token_http\tmeta_http\tlatency_ms\tremote_ip\tfunctionality_status\tcapability_summary\tresult\treason\n' \
        > "${GITHUB_ROUTE_BENCHMARK_FILE}" 2> /dev/null || true
}

append_benchmark_record() {
    local sample_index source ip score root_http rate_http user_http copilot_http meta_http latency_ms remote status details result reason
    sample_index="${1:-0}"
    source="${2:-unknown}"
    ip="${3:-unknown}"
    score="${4:-0}"
    root_http="${5:-000}"
    rate_http="${6:-skipped}"
    user_http="${7:-skipped}"
    copilot_http="${8:-skipped}"
    meta_http="${9:-skipped}"
    latency_ms="${10:-0}"
    remote="${11:-unknown}"
    status="${12:-unknown}"
    details="${13:-unknown}"
    result="${14:-unknown}"
    reason="${15:-}"
    ensure_parent_dir "${GITHUB_ROUTE_BENCHMARK_FILE}"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$(ts)" "$(tsv_safe "${sample_index}")" "$(tsv_safe "${source}")" "$(tsv_safe "${ip}")" \
        "$(tsv_safe "${score}")" "$(tsv_safe "${root_http}")" "$(tsv_safe "${rate_http}")" "$(tsv_safe "${user_http}")" \
        "$(tsv_safe "${copilot_http}")" "$(tsv_safe "${meta_http}")" "$(tsv_safe "${latency_ms}")" "$(tsv_safe "${remote}")" \
        "$(tsv_safe "${status}")" "$(tsv_safe "${details}")" "$(tsv_safe "${result}")" "$(tsv_safe "${reason}")" \
        >> "${GITHUB_ROUTE_BENCHMARK_FILE}" 2> /dev/null || true
}

benchmark_sample_current() {
    local sample_index current_result current_state current_remote current_latency current_score current_meta
    local root_http current_capability_result current_capability_status current_capability_details
    local rate_http user_http copilot_http meta_http result reason
    sample_index="${1:-0}"

    current_result="$(probe_github_api_current_route)"
    IFS='|' read -r current_state current_remote current_latency current_score current_meta <<< "${current_result}"
    root_http="$(extract_field http_code "${current_meta}")"

    local root_tls
    root_tls="$(extract_field ssl_verify_result "${current_meta}")"
    current_capability_status="failed"
    current_capability_details="root:${root_http:-000}"
    result="fail"
    if [[ "${current_state}" == "ok" ]] || root_http_is_degraded_reachable "${root_http}" "${root_tls}"; then
        current_capability_result="$(probe_current_functionality_summary)"
        IFS='|' read -r current_capability_status current_capability_details <<< "${current_capability_result}"
        current_capability_details="root:${root_http:-200},${current_capability_details:-none}"
        if [[ "${current_capability_status}" == "ok" && "${current_state}" == "ok" ]]; then
            result="ok"
        elif [[ "${current_capability_status}" == "ok" ]]; then
            result="degraded"
        elif http_is_reachable "${root_http}" "${root_tls}"; then
            result="degraded"
        fi
    elif http_is_reachable "${root_http}" "${root_tls}"; then
        result="degraded"
    fi

    rate_http="$(extract_capability_http rate "${current_capability_details}")"
    user_http="$(extract_capability_http user "${current_capability_details}")"
    copilot_http="$(extract_capability_http copilot_token "${current_capability_details}")"
    meta_http="$(extract_capability_http meta "${current_capability_details}")"
    reason="current_state=${current_state};meta=${current_meta}"

    append_benchmark_record "${sample_index}" "current" "${current_remote:-unknown}" "${current_score:-0}" \
        "${root_http:-000}" "${rate_http:-skipped}" "${user_http:-skipped}" "${copilot_http:-skipped}" "${meta_http:-skipped}" \
        "${current_latency:-0}" "${current_remote:-unknown}" "${current_capability_status}" "${current_capability_details}" "${result}" "${reason}"
}

benchmark_sample_candidates() {
    local sample_index candidates records record ip score root_http rate_http user_http latency_ms remote reason
    local copilot_http meta_http capability_status capability_summary result
    sample_index="${1:-0}"
    [[ "${BENCHMARK_INCLUDE_CANDIDATES}" == "true" ]] || return 0

    candidates="$(collect_github_api_candidates)"
    if [[ -z "${candidates}" ]]; then
        append_report "benchmark_sample=${sample_index} candidates=none"
        return 0
    fi

    if [[ "${PARALLEL_PROBES}" == "true" ]]; then
        records="$(probe_candidates_parallel "${candidates}")"
        if [[ -z "${records}" ]]; then
            records="$(probe_candidates_sequential "${candidates}")"
        fi
    else
        records="$(probe_candidates_sequential "${candidates}")"
    fi

    while IFS= read -r record; do
        [[ -n "${record}" ]] || continue
        IFS='|' read -r ip score root_http rate_http user_http latency_ms remote reason <<< "${record}"
        copilot_http="$(extract_reason_field copilot_token_http "${reason}")"
        meta_http="$(extract_reason_field meta_http "${reason}")"
        capability_status="$(extract_reason_field capability_status "${reason}")"
        capability_summary="$(extract_reason_field capabilities "${reason}")"
        result="fail"
        case "${reason}" in
            *decision=candidate-suppressed*)
                result="skipped"
                ;;
            *)
                if [[ "${capability_status}" == "ok" ]]; then
                    if is_nonnegative_int "${score}" && ((score >= MIN_SCORE)); then
                        result="ok"
                    else
                        result="degraded"
                    fi
                elif [[ "${root_http:-000}" != "000" || "${rate_http:-000}" != "000" || "${user_http:-000}" != "000" ]]; then
                    result="degraded"
                fi
                ;;
        esac
        append_benchmark_record "${sample_index}" "candidate" "${ip}" "${score:-0}" "${root_http:-000}" "${rate_http:-000}" "${user_http:-000}" "${copilot_http:-skipped}" "${meta_http:-skipped}" "${latency_ms:-0}" "${remote:-unknown}" "${capability_status:-unknown}" "${capability_summary:-unknown}" "${result}" "${reason}"
    done <<< "${records}"

    if [[ "${BENCHMARK_UPDATE_CACHE}" == "true" ]]; then
        update_cache_from_records "${records}" ""
    fi
}

generate_benchmark_summary() {
    local tmp_summary tmp_recommendation generated_epoch expires_epoch
    tmp_summary="$(make_temp_file github-api-benchmark-summary /tmp)"
    tmp_recommendation="$(make_temp_file github-api-route-recommendation /tmp)"
    [[ -n "${tmp_summary}" && -n "${tmp_recommendation}" ]] || return 1
    generated_epoch="$(now_epoch)"
    expires_epoch=$((generated_epoch + BENCHMARK_RECOMMENDATION_TTL_SECONDS))

    awk -F '	' -v min_samples="${BENCHMARK_RECOMMEND_MIN_SAMPLES}" -v max_fail="${BENCHMARK_MAX_FAIL_RATE_PERCENT}" -v min_improve="${BENCHMARK_MIN_IMPROVEMENT_PERCENT}" -v generated_epoch="${generated_epoch}" -v expires_epoch="${expires_epoch}" -v generated_at="$(ts)" -v recommendation_file="${tmp_recommendation}" '
        function sortn(a, n,    i,j,tmp) {
            for (i=1; i<=n; i++) for (j=i+1; j<=n; j++) if (a[j] < a[i]) { tmp=a[i]; a[i]=a[j]; a[j]=tmp }
        }
        function percentile(csv, p,    n,parts,i,count,idx) {
            n=split(csv, parts, ",")
            count=0
            delete vals
            for (i=1; i<=n; i++) if ((parts[i]+0) > 0) vals[++count]=parts[i]+0
            if (count <= 0) return 0
            sortn(vals, count)
            idx=int(count*p)
            if (idx < 1) idx=1
            if (idx < count && (count*p) > idx) idx++
            if (idx > count) idx=count
            return vals[idx]+0
        }
        function fail_rate_for(k) { return (total[k] > 0 ? fail[k]*100.0/total[k] : 100) }
        NR == 1 { next }
        NF >= 16 {
            if ($15 == "skipped") { skipped_rows++; next }
            key=$3 "|" $4
            source[key]=$3
            ip[key]=$4
            total[key]++
            all_samples++
            if ($15 == "ok" || $15 == "degraded") {
                reached[key]++
                if ($15 == "ok") ok[key]++
                else degraded[key]++
                lat=$11+0
                if (lat > 0) {
                    n[key]++
                    sum[key]+=lat
                    values[key]=(values[key] == "" ? lat : values[key] "," lat)
                }
            } else {
                fail[key]++
            }
            if ($3 == "current") current_key=key
        }
        END {
            print "status=ok"
            print "generated_at=" generated_at
            print "generated_epoch=" generated_epoch
            print "expires_epoch=" expires_epoch
            print "sample_rows=" all_samples
            print "skipped_rows=" skipped_rows+0
            print "min_samples=" min_samples
            print "max_fail_rate_percent=" max_fail
            print "min_improvement_percent=" min_improve

            best_key=""; best_p95=999999999; best_p50=999999999; best_fail=100
            best_candidate_key=""; best_candidate_p95=999999999; best_candidate_p50=999999999; best_candidate_fail=100
            groups=""
            for (k in total) {
                fail_rate=fail_rate_for(k)
                p50=percentile(values[k], 0.50)
                p95=percentile(values[k], 0.95)
                p99=percentile(values[k], 0.99)
                avg=(n[k] > 0 ? sum[k]/n[k] : 0)
                if (reached[k] >= min_samples && fail_rate <= max_fail && p95 > 0) {
                    if (best_key == "" || p95 < best_p95 || (p95 == best_p95 && p50 < best_p50)) {
                        best_key=k; best_p95=p95; best_p50=p50; best_fail=fail_rate
                    }
                    if (source[k] == "candidate" && (best_candidate_key == "" || p95 < best_candidate_p95 || (p95 == best_candidate_p95 && p50 < best_candidate_p50))) {
                        best_candidate_key=k; best_candidate_p95=p95; best_candidate_p50=p50; best_candidate_fail=fail_rate
                    }
                }
                ok_count=ok[k]+0; degraded_count=degraded[k]+0; fail_count=fail[k]+0
                group_line="group=" k ";total=" total[k] ";ok=" ok_count ";degraded=" degraded_count ";fail=" fail_count ";fail_rate_percent=" sprintf("%.2f", fail_rate) ";p50_ms=" p50 ";p95_ms=" p95 ";p99_ms=" p99 ";avg_ms=" sprintf("%.2f", avg)
                groups=groups group_line "\n"
            }

            action="insufficient-data"; reason="no-group-met-minimum-samples"; recommended_ip="none"; recommended_source="none"; confidence="low"
            current_p95=0; current_fail=100; current_ip="unknown"; current_has_baseline=0
            if (current_key != "") {
                current_p95=percentile(values[current_key], 0.95)
                current_fail=fail_rate_for(current_key)
                current_ip=ip[current_key]
                if (reached[current_key] >= min_samples && current_fail <= max_fail && current_p95 > 0) current_has_baseline=1
            }
            best_candidate_ip="none"; best_candidate_source="none"
            if (best_candidate_key != "") { split(best_candidate_key, bc, "|"); best_candidate_source=bc[1]; best_candidate_ip=bc[2] }

            if (current_has_baseline) {
                action="keep-current"; recommended_ip=current_ip; recommended_source="current"
                confidence=(reached[current_key] >= (min_samples * 3) && current_fail == 0 && degraded[current_key] == 0 ? "high" : "medium")
                reason="current-functional-no-better-candidate"
                if (best_candidate_key != "") {
                    threshold=current_p95 * (100 - min_improve) / 100
                    if (best_key == current_key || best_candidate_ip == current_ip) {
                        reason="current-is-best-or-equivalent"
                    } else if (best_candidate_p95 <= threshold && best_candidate_fail <= current_fail) {
                        action="consider-route-override"; recommended_ip=best_candidate_ip; recommended_source="candidate"
                        confidence=(reached[best_candidate_key] >= (min_samples * 3) && best_candidate_fail == 0 && degraded[best_candidate_key] == 0 ? "high" : "medium")
                        reason="candidate-p95-improved"
                    } else {
                        reason="candidate-improvement-below-threshold"
                    }
                }
            } else if (best_candidate_key != "") {
                action="consider-route-override"; recommended_ip=best_candidate_ip; recommended_source="candidate"
                confidence=(reached[best_candidate_key] >= (min_samples * 3) && best_candidate_fail == 0 && degraded[best_candidate_key] == 0 ? "high" : "medium")
                reason="no-current-baseline"
            }

            print "recommended_action=" action
            print "recommended_ip=" recommended_ip
            print "recommended_source=" recommended_source
            print "confidence=" confidence
            print "reason=" reason
            print "best_p95_ms=" (best_key == "" ? "unknown" : best_p95)
            print "best_candidate_ip=" best_candidate_ip
            print "best_candidate_source=" best_candidate_source
            print "best_candidate_p95_ms=" (best_candidate_key == "" ? "unknown" : best_candidate_p95)
            print "best_candidate_fail_rate_percent=" (best_candidate_key == "" ? "unknown" : sprintf("%.2f", best_candidate_fail))
            print "current_ip=" current_ip
            print "current_p95_ms=" (current_p95 > 0 ? current_p95 : "unknown")
            print "current_fail_rate_percent=" (current_key == "" ? "unknown" : sprintf("%.2f", current_fail))
            print "groups_begin"; printf "%s", groups; print "groups_end"

            print "scope=github-api-route" > recommendation_file
            print "generated_at=" generated_at >> recommendation_file
            print "generated_epoch=" generated_epoch >> recommendation_file
            print "expires_epoch=" expires_epoch >> recommendation_file
            print "recommended_action=" action >> recommendation_file
            print "recommended_ip=" recommended_ip >> recommendation_file
            print "recommended_source=" recommended_source >> recommendation_file
            print "confidence=" confidence >> recommendation_file
            print "reason=" reason >> recommendation_file
            print "best_p95_ms=" (best_key == "" ? "unknown" : best_p95) >> recommendation_file
            print "best_candidate_ip=" best_candidate_ip >> recommendation_file
            print "best_candidate_source=" best_candidate_source >> recommendation_file
            print "best_candidate_p95_ms=" (best_candidate_key == "" ? "unknown" : best_candidate_p95) >> recommendation_file
            print "best_candidate_fail_rate_percent=" (best_candidate_key == "" ? "unknown" : sprintf("%.2f", best_candidate_fail)) >> recommendation_file
            print "current_ip=" current_ip >> recommendation_file
            print "current_p95_ms=" (current_p95 > 0 ? current_p95 : "unknown") >> recommendation_file
            print "current_fail_rate_percent=" (current_key == "" ? "unknown" : sprintf("%.2f", current_fail)) >> recommendation_file
            print "min_samples=" min_samples >> recommendation_file
            print "max_fail_rate_percent=" max_fail >> recommendation_file
            print "min_improvement_percent=" min_improve >> recommendation_file
        }' "${GITHUB_ROUTE_BENCHMARK_FILE}" > "${tmp_summary}" 2> /dev/null || {
        safe_remove_temp_file "${tmp_summary}"
        safe_remove_temp_file "${tmp_recommendation}"
        return 1
    }

    mv -f "${tmp_summary}" "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}" 2> /dev/null || return 1
    chmod 0644 "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}" 2> /dev/null || true
    mv -f "${tmp_recommendation}" "${GITHUB_ROUTE_RECOMMENDATION_FILE}" 2> /dev/null || return 1
    chmod 0644 "${GITHUB_ROUTE_RECOMMENDATION_FILE}" 2> /dev/null || true
    return 0
}

benchmark_action() {
    local start_epoch now elapsed sample_index next_sleep
    write_report_header
    write_metrics_header
    write_benchmark_header
    write_status "benchmarking"
    append_report "benchmark=started duration_seconds=${BENCHMARK_DURATION_SECONDS} interval_seconds=${BENCHMARK_INTERVAL_SECONDS} max_samples=${BENCHMARK_MAX_SAMPLES} include_candidates=${BENCHMARK_INCLUDE_CANDIDATES} update_cache=${BENCHMARK_UPDATE_CACHE}"

    if ! is_safe_hostname "${GITHUB_API_HOST}"; then
        log_warn "benchmark: host inválido/não seguro: ${GITHUB_API_HOST}"
        write_status "benchmark-failed"
        return 1
    fi
    if ! has_cmd curl; then
        log_warn "benchmark: curl não encontrado; não é possível medir rota."
        write_status "benchmark-failed"
        return 1
    fi
    ensure_cache_file || true

    start_epoch="$(now_epoch)"
    sample_index=0
    while true; do
        now="$(now_epoch)"
        elapsed=$((now - start_epoch))
        if ((sample_index > 0 && elapsed >= BENCHMARK_DURATION_SECONDS)); then
            break
        fi
        if ((BENCHMARK_MAX_SAMPLES > 0 && sample_index >= BENCHMARK_MAX_SAMPLES)); then
            break
        fi

        sample_index=$((sample_index + 1))
        log_info "benchmark sample=${sample_index}; elapsed=${elapsed}s; profile=${FUNCTIONALITY_PROFILE}."
        append_report "benchmark_sample=${sample_index} elapsed_seconds=${elapsed}"
        benchmark_sample_current "${sample_index}"
        benchmark_sample_candidates "${sample_index}"

        now="$(now_epoch)"
        elapsed=$((now - start_epoch))
        if ((elapsed >= BENCHMARK_DURATION_SECONDS)); then
            break
        fi
        if ((BENCHMARK_MAX_SAMPLES > 0 && sample_index >= BENCHMARK_MAX_SAMPLES)); then
            break
        fi
        next_sleep="${BENCHMARK_INTERVAL_SECONDS}"
        if ((elapsed + next_sleep > BENCHMARK_DURATION_SECONDS)); then
            next_sleep=$((BENCHMARK_DURATION_SECONDS - elapsed))
        fi
        ((next_sleep > 0)) && sleep "${next_sleep}"
    done

    if generate_benchmark_summary; then
        set_summary_functionality_manual "benchmark-ok" "profile:${FUNCTIONALITY_PROFILE},samples:${sample_index}"
        write_summary "benchmark-ok" "none" "unknown" "unknown" "unknown" "unknown" "unknown" "decision=benchmark;cause=completed"
        write_status "benchmark-ok"
        append_report "benchmark=ok samples=${sample_index} benchmark_file=${GITHUB_ROUTE_BENCHMARK_FILE} benchmark_summary=${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE} recommendation=${GITHUB_ROUTE_RECOMMENDATION_FILE}"
        log_ok "benchmark concluído: samples=${sample_index}; summary=${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}; recommendation=${GITHUB_ROUTE_RECOMMENDATION_FILE}."
        return 0
    fi

    write_status "benchmark-degraded"
    append_report "benchmark=summary-failed samples=${sample_index}"
    log_warn "benchmark executou, mas falhou ao gerar summary/recommendation."
    return 1
}

# -----------------------------------------------------------------------------
# Actions
# -----------------------------------------------------------------------------
doctor_action() {
    local rc cache_dir hosts_probe
    rc=0
    cache_dir="$(dirname "${CACHE_FILE}" 2> /dev/null || printf '/tmp')"
    log_info "doctor: validando dependências e contrato de rota GitHub API."

    for cmd in curl awk mktemp date grep sed; do
        if has_cmd "${cmd}"; then
            log_ok "doctor: ${cmd} disponível."
        else
            log_warn "doctor: ${cmd} indisponível."
            rc=1
        fi
    done
    if has_cmd getent; then log_ok "doctor: getent disponível."; else log_warn "doctor: getent ausente; descoberta de rota atual será limitada."; fi
    if has_cmd dig; then log_ok "doctor: dig disponível."; else log_warn "doctor: dig ausente; descoberta por resolvers externos será limitada."; fi
    if has_cmd flock; then log_ok "doctor: flock disponível."; else log_warn "doctor: flock ausente; cache/hosts terão lock best-effort."; fi
    if has_cmd sudo || [[ "$(id -u 2> /dev/null || echo 1)" == "0" ]]; then
        log_ok "doctor: mutação privilegiada potencialmente disponível quando necessária."
    else
        log_warn "doctor: sudo não interativo indisponível; start poderá apenas diagnosticar/probar sem aplicar hosts."
    fi

    if ! is_safe_hostname "${GITHUB_API_HOST}"; then
        log_warn "doctor: host inválido/não seguro: ${GITHUB_API_HOST}."
        rc=1
    elif [[ "${GITHUB_API_HOST}" != "api.github.com" && "${ALLOW_CUSTOM_HOST}" != "true" ]]; then
        log_warn "doctor: host customizado bloqueado sem DEVCONTAINER_GITHUB_API_ALLOW_CUSTOM_HOST=true."
        rc=1
    else
        log_ok "doctor: host aceito: ${GITHUB_API_HOST}."
    fi

    mkdir -p "${cache_dir}" 2> /dev/null || true
    if [[ "${CACHE_ENABLED}" == "true" ]]; then
        if [[ -d "${cache_dir}" && -w "${cache_dir}" ]]; then
            log_ok "doctor: cache dir gravável: ${cache_dir}."
        else
            log_warn "doctor: cache dir não gravável: ${cache_dir}."
        fi
    fi

    hosts_probe="readable"
    [[ -r /etc/hosts ]] || {
        hosts_probe="unreadable"
        rc=1
    }
    append_report "doctor_hosts_file=${hosts_probe}"

    if [[ "${GITHUB_API_VERSION}" != "2022-11-28" && ! "${GITHUB_API_VERSION}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        log_warn "doctor: api_version inválida: ${GITHUB_API_VERSION}."
        rc=1
    fi

    set_summary_functionality_manual "doctor" "host:${GITHUB_API_HOST},api_version:${GITHUB_API_VERSION},profile:${FUNCTIONALITY_PROFILE}"
    if [[ "${rc}" -eq 0 ]]; then
        write_status "ok"
        write_summary "ok" "none" "unknown" "unknown" "unknown" "unknown" "unknown" "decision=doctor;cause=ok"
    else
        write_status "degraded"
        write_summary "degraded" "none" "unknown" "unknown" "unknown" "unknown" "unknown" "decision=doctor;cause=degraded"
    fi
    return "${rc}"
}

status_action() {
    local status
    status="$(read_first_line_or "${GITHUB_ROUTE_STATUS_FILE}" unknown)"
    log_info "status=${status}; report=${GITHUB_ROUTE_REPORT_FILE}; summary=${GITHUB_ROUTE_SUMMARY_FILE}; metrics=${GITHUB_ROUTE_METRICS_FILE}; benchmark_summary=${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}; recommendation=${GITHUB_ROUTE_RECOMMENDATION_FILE}; cache=${CACHE_FILE}"
    if [[ -r "${GITHUB_ROUTE_SUMMARY_FILE}" ]]; then
        sed -n '1,200p' "${GITHUB_ROUTE_SUMMARY_FILE}" 2> /dev/null || true
    fi
    if [[ -r "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}" ]]; then
        printf '%s\n' '--- benchmark.summary ---'
        sed -n '1,220p' "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}" 2> /dev/null || true
    fi
    if [[ -r "${GITHUB_ROUTE_RECOMMENDATION_FILE}" ]]; then
        printf '%s\n' '--- recommendation ---'
        sed -n '1,120p' "${GITHUB_ROUTE_RECOMMENDATION_FILE}" 2> /dev/null || true
    fi
    return 0
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    log_info "Smart GitHub API route fix iniciado (v${SCRIPT_VERSION})."
    log_info "action=${ACTION}; host=${GITHUB_API_HOST}; report=${GITHUB_ROUTE_REPORT_FILE}; cache=${CACHE_FILE}; proxy_mode=${PROXY_MODE}; ipv6=${ENABLE_IPV6}; parallel=${PARALLEL_PROBES}; dry_run=${DRY_RUN}; api_version=${GITHUB_API_VERSION}; functionality_profile=${FUNCTIONALITY_PROFILE}"

    case "${ACTION}" in
        status)
            status_action
            return 0
            ;;
        clear-cache)
            write_report_header
            clear_cache
            write_status "cache-cleared"
            write_summary "cache-cleared" "" "" "" "" "" "" "decision=cache;cause=clear-cache"
            log_ok "cache de rota GitHub API limpo: ${CACHE_FILE}"
            return 0
            ;;
        benchmark)
            benchmark_action
            return $?
            ;;
        doctor)
            write_report_header
            doctor_action
            return $?
            ;;
        probe)
            :
            ;;
        *)
            :
            ;;
    esac

    select_and_apply_route
    local rc=$?

    if [[ "${rc}" -eq 0 ]]; then
        write_status "ok"
        log_ok "Smart GitHub API route fix concluído com sucesso."
    else
        write_status "failed"
        log_warn "Smart GitHub API route fix não conseguiu provar/aplicar rota funcional (rc=${rc})."
    fi

    return "${rc}"
}

main "$@"
exit $?
