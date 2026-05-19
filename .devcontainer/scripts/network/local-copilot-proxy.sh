#!/usr/bin/env bash
# =============================================================================
# local-copilot-proxy.sh — Optional Local HTTP CONNECT Proxy Manager
# Version: v1.3.1
#
# Purpose:
#   Manage an optional loopback-only HTTP CONNECT proxy for GitHub/Copilot
#   diagnostics and opt-in VS Code/Copilot proxy flows inside a DevContainer.
#
# Contract:
#   - Runtime-only helper; does not mutate Docker/DevContainer structure.
#   - Does not change the parent process environment; writes env/profile hints.
#   - Starts only a loopback-bound local proxy by default; never public-facing.
#   - Uses tinyproxy when available; mode=auto degrades to off when absent.
#   - Returns 0 for optional/off/auto-skip/status-observation states.
#   - Returns non-zero when local/start/probe explicitly requires a working proxy
#     but it cannot be proven.
#   - No application services are started.
#
# Security model:
#   - Default bind address is 127.0.0.1.
#   - Non-loopback bind is refused unless explicitly enabled by
#     DEVCONTAINER_LOCAL_COPILOT_PROXY_ALLOW_NON_LOOPBACK=true.
#   - CONNECT is restricted to configured ports, default 443.
#   - No TLS interception, no certificate injection, no credential capture.
#   - Generated env/profile hints are opt-in and local-loopback only by default.
#
# v1.2.3 focus:
#   - Fixes lock inheritance from the long-running tinyproxy child. The proxy
#     process now starts with the control-plane flock FD explicitly closed, so
#     benchmark/compare/status commands are not blocked while the proxy is alive.
#   - Makes lock failures observable: status/report/summary/recommendation are
#     written even when the exclusive lock cannot be acquired.
#   - Adds positional action support for start|stop|status|restart|probe|env|
#     doctor|benchmark|compare, while preserving environment-driven operation.
#   - Treats GitHub REST root 403/429 as reachable/degraded API responses for
#     transport comparison, avoiding false fail-rate inflation during rate-limit
#     or forbidden-response windows.
#   - Ensures compare-off/compare-lock-failed paths emit recommendation artifacts
#     instead of leaving the manager with proxy_recommendation=unknown.
#
# v1.3.0 focus:
#   - Promotes the canonical GitHub/Copilot endpoint registry as the default
#     source for proxy probes, with a bounded embedded fallback set.
#   - Rejects arbitrary probe URLs by default to avoid credential/userinfo leaks
#     and accidental probing of non-GitHub surfaces.
#   - Emits endpoint registry status, row counts and probe source in report and
#     summary artifacts.
#
# v1.3.1 focus:
#   - Fixes ShellCheck SC2221/SC2222 by removing a redundant Azure Front Door
#     case pattern that was fully covered by the broader Copilot reports glob.
#   - Fixes ShellCheck SC2086 by counting probe URLs without unquoted expansion.
#   - Hardens probe URL parsing: HTTPS is required by default, HTTP targets are
#     accepted only when custom probe URLs are explicitly allowed.
#   - Normalizes expected-HTTP host matching to lowercase and reports acquired
#     lock state in summary artifacts.
#   - Corrects already-running start status from starting to running.
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
        printf '%s v%s\n' 'local-copilot-proxy.sh' '1.3.1'
        exit 0
        ;;
    --help)
        cat << 'USAGE'
local-copilot-proxy.sh [--help] [--version]

Environment-driven actions:
  DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=start|stop|status|restart|probe|env|doctor|benchmark|compare

Core modes:
  DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE=local|auto|off
  DEVCONTAINER_COPILOT_PROXY_MODE=local|auto|off     # legacy alias

This script is runtime-only. It may start/stop a loopback tinyproxy instance
when explicitly asked, but it never mutates Docker/DevContainer structure and
never exports proxy variables into its parent process.

Benchmark actions:
  benchmark  Measures the local proxy over multiple samples without changing env.
  compare    Runs direct-vs-proxy A/B samples and writes a recommendation.

Endpoint governance:
  By default, proxy probes are read from DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE
  when present, falling back to the embedded GitHub/Copilot endpoint set. Set
  DEVCONTAINER_LOCAL_COPILOT_PROXY_PROBE_URLS only for an explicit override.
USAGE
        exit 0
        ;;
esac

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

sanitize_oneline() {
    printf '%s' "${1:-}" | tr '\n\r\t' '   ' | sed 's/[[:cntrl:]]//g' 2> /dev/null || true
}

sanitize_tsv_field() {
    sanitize_oneline "${1:-}" | sed 's/\t/ /g' 2> /dev/null || true
}

cmd_available_word() {
    if has_cmd "$1"; then
        printf 'true'
    else
        printf 'false'
    fi
}

space_list_to_lines() {
    # Convert a whitespace-separated control-plane list to one item per line
    # without unquoted expansion. Probe URLs and port lists are explicitly not
    # allowed to contain whitespace, so this preserves the existing contract
    # while avoiding globbing surprises.
    awk '{ for (i = 1; i <= NF; i++) print $i }' <<< "${1:-}" 2> /dev/null || true
}

normalize_space_list() {
    local item out
    out=""
    while IFS= read -r item; do
        [[ -z "${item}" ]] && continue
        if [[ -z "${out}" ]]; then
            out="${item}"
        else
            out="${out} ${item}"
        fi
    done < <(space_list_to_lines "${1:-}")
    printf '%s' "${out}"
}

count_space_list() {
    # Count a whitespace-separated list without unquoted expansion. This avoids
    # glob expansion and keeps ShellCheck SC2086 satisfied while preserving the
    # script's list contract: probe URLs themselves must not contain whitespace.
    space_list_to_lines "${1:-}" | awk 'NF { c++ } END { print c + 0 }' 2> /dev/null || printf '0'
}

# -----------------------------------------------------------------------------
# Constants / sanitized config
# -----------------------------------------------------------------------------
SCRIPT_NAME="local-copilot-proxy.sh"
readonly SCRIPT_NAME
SCRIPT_VERSION="1.3.1"
readonly SCRIPT_VERSION

SCRIPT_DIR=""
SCRIPT_DIR_TMP=""
if SCRIPT_DIR_TMP="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2> /dev/null && pwd -P 2> /dev/null)"; then
    SCRIPT_DIR="${SCRIPT_DIR_TMP}"
else
    SCRIPT_DIR="$(pwd -P 2> /dev/null || printf '.')"
fi
readonly SCRIPT_DIR

REQUESTED_ACTION="${DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION:-${1:-start}}"
case "${REQUESTED_ACTION}" in
    start | stop | status | restart | probe | env | doctor | benchmark | compare) ACTION="${REQUESTED_ACTION}" ;;
    *) ACTION="start" ;;
esac
readonly REQUESTED_ACTION ACTION

PROXY_MODE_RAW="${DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE:-${DEVCONTAINER_COPILOT_PROXY_MODE:-local}}"
case "${PROXY_MODE_RAW}" in
    off | disabled | false | none) PROXY_MODE="off" ;;
    local | auto) PROXY_MODE="${PROXY_MODE_RAW}" ;;
    *) PROXY_MODE="local" ;;
esac
readonly PROXY_MODE PROXY_MODE_RAW

PROXY_HOST_RAW="${DEVCONTAINER_LOCAL_COPILOT_PROXY_HOST:-127.0.0.1}"
readonly PROXY_HOST_RAW
case "${PROXY_HOST_RAW}" in
    localhost) PROXY_HOST="127.0.0.1" ;;
    '[::1]') PROXY_HOST="::1" ;;
    *) PROXY_HOST="${PROXY_HOST_RAW}" ;;
esac
readonly PROXY_HOST

PROXY_PORT="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_PORT:-3128}" 3128 1024 65535)"
readonly PROXY_PORT

if [[ "${PROXY_HOST}" == *:* ]]; then
    PROXY_URL="http://[${PROXY_HOST}]:${PROXY_PORT}"
else
    PROXY_URL="http://${PROXY_HOST}:${PROXY_PORT}"
fi
readonly PROXY_URL

RUNTIME_DIR="${DEVCONTAINER_LOCAL_COPILOT_PROXY_RUNTIME_DIR:-/tmp/devcontainer-network}"
readonly RUNTIME_DIR
TINYPROXY_CONF="${DEVCONTAINER_LOCAL_COPILOT_PROXY_CONF:-${RUNTIME_DIR}/tinyproxy-copilot.conf}"
readonly TINYPROXY_CONF
TINYPROXY_PID_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_PID_FILE:-${RUNTIME_DIR}/tinyproxy-copilot.pid}"
readonly TINYPROXY_PID_FILE
TINYPROXY_LOG_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_LOG_FILE:-${RUNTIME_DIR}/tinyproxy-copilot.log}"
readonly TINYPROXY_LOG_FILE
LOCK_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_LOCK_FILE:-${RUNTIME_DIR}/tinyproxy-copilot.lock}"
readonly LOCK_FILE
LOCK_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_LOCK_WAIT_SECONDS:-10}" 10 0 120)"
readonly LOCK_WAIT_SECONDS

ENV_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_ENV_FILE:-/tmp/devcontainer-copilot-proxy.env}"
readonly ENV_FILE
VSCODE_SETTINGS_HINT_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_VSCODE_HINT_FILE:-/tmp/devcontainer-copilot-proxy.vscode-settings.json}"
readonly VSCODE_SETTINGS_HINT_FILE
REPORT_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_REPORT_FILE:-/tmp/devcontainer-copilot-proxy.report}"
readonly REPORT_FILE
STATUS_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_FILE:-/tmp/devcontainer-copilot-proxy.status}"
readonly STATUS_FILE
SUMMARY_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_SUMMARY_FILE:-/tmp/devcontainer-copilot-proxy.summary}"
readonly SUMMARY_FILE
METRICS_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_METRICS_FILE:-/tmp/devcontainer-copilot-proxy.metrics.tsv}"
readonly METRICS_FILE
BENCHMARK_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_FILE:-/tmp/devcontainer-copilot-proxy.benchmark.tsv}"
readonly BENCHMARK_FILE
BENCHMARK_SUMMARY_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE:-/tmp/devcontainer-copilot-proxy.benchmark.summary}"
readonly BENCHMARK_SUMMARY_FILE
COMPARISON_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_COMPARISON_FILE:-/tmp/devcontainer-copilot-proxy.comparison.tsv}"
readonly COMPARISON_FILE
RECOMMENDATION_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE:-/tmp/devcontainer-copilot-proxy.recommendation}"
readonly RECOMMENDATION_FILE

DEFAULT_PROBE_URLS="https://api.github.com/ https://api.github.com/rate_limit https://api.github.com/user https://api.github.com/copilot_internal/v2/token https://github.com/login https://github.com/copilot https://copilot-proxy.githubusercontent.com/ https://api.githubcopilot.com/ https://api.individual.githubcopilot.com/ https://proxy.individual.githubcopilot.com/ https://origin-tracker.githubusercontent.com/ https://copilot-telemetry.githubusercontent.com/ https://default.exp-tas.com/"
ENDPOINT_REGISTRY_CANONICAL_FILE="${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE:-${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY:-${SCRIPT_DIR}/endpoints.github-copilot.tsv}}"
readonly ENDPOINT_REGISTRY_CANONICAL_FILE
ENDPOINT_REGISTRY_LEGACY_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_LEGACY_ENDPOINT_REGISTRY_FILE:-${SCRIPT_DIR}/../../network/endpoints.github-copilot.tsv}"
readonly ENDPOINT_REGISTRY_LEGACY_FILE
USE_ENDPOINT_REGISTRY="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_USE_ENDPOINT_REGISTRY:-${DEVCONTAINER_COPILOT_USE_ENDPOINT_REGISTRY:-true}}" true)"
readonly USE_ENDPOINT_REGISTRY
MAX_PROBE_URLS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_MAX_PROBE_URLS:-64}" 64 1 128)"
readonly MAX_PROBE_URLS
ALLOW_CUSTOM_PROBE_URLS="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_ALLOW_CUSTOM_PROBE_URLS:-false}" false)"
readonly ALLOW_CUSTOM_PROBE_URLS
REGISTRY_PROBE_URLS=""
PROBE_URL_SOURCE="default"
PROBE_REGISTRY_FILE="none"
PROBE_REGISTRY_STATUS="not-used"
PROBE_REGISTRY_ROWS="0"
PROBE_REGISTRY_BAD_ROWS="0"
PROBE_URL_COUNT="0"

read_registry_probe_urls() {
    local file max
    file="${1:-}"
    max="${2:-${MAX_PROBE_URLS}}"
    [[ -r "${file}" ]] || return 1
    awk -F'	' -v max="${max}" '
        /^[[:space:]]*#/ { next }
        NF == 0 { next }
        NF != 5 { next }
        $1 ~ /^https:\/\// && $1 !~ /[[:space:]\\]/ && $1 !~ /@/ {
            if (!seen[$1]++) {
                print $1
                emitted++
                if (emitted >= max) exit
            }
        }
    ' "${file}" 2> /dev/null
}

audit_endpoint_registry_file() {
    local file rows bad
    file="${1:-}"
    [[ -r "${file}" ]] || return 1
    rows="$(awk -F'	' '/^[[:space:]]*#/ {next} NF == 0 {next} {c++} END {print c+0}' "${file}" 2> /dev/null || printf '0')"
    bad="$(awk -F'	' '
        /^[[:space:]]*#/ { next }
        NF == 0 { next }
        NF != 5 { bad++; next }
        $1 !~ /^https:\/\// { bad++; next }
        $1 ~ /[[:space:]\\]/ { bad++; next }
        $1 ~ /@/ { bad++; next }
        END { print bad+0 }
    ' "${file}" 2> /dev/null || printf '0')"
    PROBE_REGISTRY_ROWS="${rows:-0}"
    PROBE_REGISTRY_BAD_ROWS="${bad:-0}"
    if [[ "${PROBE_REGISTRY_BAD_ROWS}" != "0" ]]; then
        PROBE_REGISTRY_STATUS="invalid"
        return 1
    fi
    if [[ "${PROBE_REGISTRY_ROWS}" == "0" ]]; then
        PROBE_REGISTRY_STATUS="empty"
        return 1
    fi
    PROBE_REGISTRY_STATUS="ok"
    return 0
}

if [[ -n "${DEVCONTAINER_LOCAL_COPILOT_PROXY_PROBE_URLS:-}${DEVCONTAINER_LOCAL_COPILOT_PROXY_PROBE_URL:-}" ]]; then
    PROBE_URLS="$(normalize_space_list "${DEVCONTAINER_LOCAL_COPILOT_PROXY_PROBE_URLS:-${DEVCONTAINER_LOCAL_COPILOT_PROXY_PROBE_URL:-}}")"
    PROBE_URL_SOURCE="env-override"
elif [[ "${USE_ENDPOINT_REGISTRY}" == "true" ]]; then
    if [[ -r "${ENDPOINT_REGISTRY_CANONICAL_FILE}" ]]; then
        PROBE_REGISTRY_FILE="${ENDPOINT_REGISTRY_CANONICAL_FILE}"
    elif [[ -r "${ENDPOINT_REGISTRY_LEGACY_FILE}" ]]; then
        PROBE_REGISTRY_FILE="${ENDPOINT_REGISTRY_LEGACY_FILE}"
    fi
    if [[ "${PROBE_REGISTRY_FILE}" != "none" ]]; then
        audit_endpoint_registry_file "${PROBE_REGISTRY_FILE}" || true
        REGISTRY_PROBE_URLS="$(read_registry_probe_urls "${PROBE_REGISTRY_FILE}" "${MAX_PROBE_URLS}" | awk 'NF { printf "%s%s", sep, $0; sep=" " }' 2> /dev/null || true)"
        if [[ -n "${REGISTRY_PROBE_URLS}" ]]; then
            PROBE_URLS="$(normalize_space_list "${REGISTRY_PROBE_URLS}")"
            PROBE_URL_SOURCE="registry"
        else
            PROBE_URLS="$(normalize_space_list "${DEFAULT_PROBE_URLS}")"
            PROBE_URL_SOURCE="default-registry-empty"
        fi
    else
        PROBE_REGISTRY_STATUS="missing"
        PROBE_URLS="$(normalize_space_list "${DEFAULT_PROBE_URLS}")"
        PROBE_URL_SOURCE="default-registry-missing"
    fi
else
    PROBE_REGISTRY_STATUS="disabled"
    PROBE_URLS="$(normalize_space_list "${DEFAULT_PROBE_URLS}")"
    PROBE_URL_SOURCE="default-registry-disabled"
fi
PROBE_URL_COUNT="$(count_space_list "${PROBE_URLS}")"
readonly DEFAULT_PROBE_URLS PROBE_URLS PROBE_URL_SOURCE PROBE_REGISTRY_FILE PROBE_REGISTRY_STATUS PROBE_REGISTRY_ROWS PROBE_REGISTRY_BAD_ROWS PROBE_URL_COUNT
CONNECT_TIMEOUT="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_CONNECT_TIMEOUT:-4}" 4 1 60)"
readonly CONNECT_TIMEOUT
MAX_TIME="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_MAX_TIME:-12}" 12 2 180)"
readonly MAX_TIME
START_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_START_WAIT_SECONDS:-3}" 3 1 30)"
readonly START_WAIT_SECONDS

APPLY_PROFILE="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_APPLY_PROFILE:-false}" false)"
readonly APPLY_PROFILE
REMOVE_PROFILE_ON_STOP="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_REMOVE_PROFILE_ON_STOP:-false}" false)"
readonly REMOVE_PROFILE_ON_STOP
PROFILE_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_PROFILE_FILE:-/etc/profile.d/99-devcontainer-copilot-proxy.sh}"
readonly PROFILE_FILE
NO_PROXY_VALUE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_NO_PROXY:-localhost,127.0.0.1,::1,host.docker.internal}"
readonly NO_PROXY_VALUE

ALLOW_NON_LOOPBACK="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_ALLOW_NON_LOOPBACK:-false}" false)"
readonly ALLOW_NON_LOOPBACK
CONNECT_PORTS_RAW="${DEVCONTAINER_LOCAL_COPILOT_PROXY_CONNECT_PORTS:-443}"
CONNECT_PORTS=""
while IFS= read -r _connect_port_candidate; do
    _connect_port="$(cfg_uint "${_connect_port_candidate}" 0 1 65535)"
    if [[ "${_connect_port}" != "0" ]]; then
        case " ${CONNECT_PORTS} " in
            *" ${_connect_port} "*) : ;;
            *)
                if [[ -z "${CONNECT_PORTS}" ]]; then
                    CONNECT_PORTS="${_connect_port}"
                else
                    CONNECT_PORTS="${CONNECT_PORTS} ${_connect_port}"
                fi
                ;;
        esac
    fi
done < <(space_list_to_lines "${CONNECT_PORTS_RAW}")
if [[ -z "${CONNECT_PORTS}" ]]; then
    CONNECT_PORTS="443"
fi
unset _connect_port_candidate _connect_port
readonly CONNECT_PORTS_RAW CONNECT_PORTS
STATUS_STRICT="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_STRICT:-false}" false)"
readonly STATUS_STRICT

BENCHMARK_DURATION_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_DURATION_SECONDS:-600}" 600 1 7200)"
readonly BENCHMARK_DURATION_SECONDS
BENCHMARK_INTERVAL_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_INTERVAL_SECONDS:-10}" 10 1 600)"
readonly BENCHMARK_INTERVAL_SECONDS
BENCHMARK_MAX_SAMPLES="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_MAX_SAMPLES:-0}" 0 0 10000)"
readonly BENCHMARK_MAX_SAMPLES
BENCHMARK_MIN_SAMPLES="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_MIN_SAMPLES:-5}" 5 1 10000)"
readonly BENCHMARK_MIN_SAMPLES
BENCHMARK_MAX_FAIL_RATE_PERCENT="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_MAX_FAIL_RATE_PERCENT:-10}" 10 0 100)"
readonly BENCHMARK_MAX_FAIL_RATE_PERCENT
BENCHMARK_MIN_IMPROVEMENT_PERCENT="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_MIN_IMPROVEMENT_PERCENT:-25}" 25 0 100)"
readonly BENCHMARK_MIN_IMPROVEMENT_PERCENT
BENCHMARK_RECOMMENDATION_TTL_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_RECOMMENDATION_TTL_SECONDS:-86400}" 86400 60 604800)"
readonly BENCHMARK_RECOMMENDATION_TTL_SECONDS
BENCHMARK_LOG_MAX_BYTES="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_LOG_MAX_BYTES:-1048576}" 1048576 0 10485760)"
readonly BENCHMARK_LOG_MAX_BYTES
COMPARE_REQUIRE_PROXY_STARTED="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_COMPARE_START_PROXY:-true}" true)"
readonly COMPARE_REQUIRE_PROXY_STARTED
COMPARE_KEEP_PROXY_AFTER_RUN="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_COMPARE_KEEP_PROXY:-true}" true)"
readonly COMPARE_KEEP_PROXY_AFTER_RUN

TINYPROXY_TIMEOUT_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_TIMEOUT_SECONDS:-600}" 600 10 7200)"
readonly TINYPROXY_TIMEOUT_SECONDS
TINYPROXY_MAX_CLIENTS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_MAX_CLIENTS:-64}" 64 1 1024)"
readonly TINYPROXY_MAX_CLIENTS
TINYPROXY_START_SERVERS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_START_SERVERS:-1}" 1 1 64)"
readonly TINYPROXY_START_SERVERS
TINYPROXY_MIN_SPARE="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_MIN_SPARE:-1}" 1 1 64)"
readonly TINYPROXY_MIN_SPARE
TINYPROXY_MAX_SPARE="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_MAX_SPARE:-4}" 4 1 128)"
readonly TINYPROXY_MAX_SPARE
TINYPROXY_LOG_LEVEL="${DEVCONTAINER_LOCAL_COPILOT_PROXY_LOG_LEVEL:-Connect}"
case "${TINYPROXY_LOG_LEVEL}" in
    Critical | Error | Warning | Notice | Connect | Info) : ;;
    critical) TINYPROXY_LOG_LEVEL="Critical" ;;
    error) TINYPROXY_LOG_LEVEL="Error" ;;
    warning) TINYPROXY_LOG_LEVEL="Warning" ;;
    notice) TINYPROXY_LOG_LEVEL="Notice" ;;
    connect) TINYPROXY_LOG_LEVEL="Connect" ;;
    info) TINYPROXY_LOG_LEVEL="Info" ;;
    *) TINYPROXY_LOG_LEVEL="Connect" ;;
esac
readonly TINYPROXY_LOG_LEVEL

DISABLE_VIA_HEADER="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_DISABLE_VIA_HEADER:-false}" false)"
readonly DISABLE_VIA_HEADER

# Runtime state filled by lifecycle/probe functions.
LAST_REASON="not-run"
LAST_PID="unknown"
LISTEN_STATUS="unknown"
TINYPROXY_VERSION="unknown"
PROBE_OVERALL="not-run"
PROBE_OK_COUNT="0"
PROBE_TOTAL_COUNT="0"
LAST_HTTP_CODE="000"
LAST_REMOTE_IP="unknown"
LAST_TOTAL_MS="0"
ENV_HINT_READY="0"
BENCHMARK_STATUS="not-run"
BENCHMARK_SAMPLES="0"
COMPARISON_STATUS="not-run"
RECOMMENDATION_ACTION="none"
LOCK_STATUS="not-checked"
LOCK_DIAGNOSTICS="none"

# -----------------------------------------------------------------------------
# Logging/report helpers
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

write_atomic_content() {
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

write_status() {
    local value
    value="${1:-unknown}"
    printf '%s\n' "${value}" | write_atomic_content "${STATUS_FILE}" 0644 || true
}

append_report() {
    ensure_parent_dir "${REPORT_FILE}"
    printf '%s\n' "$*" >> "${REPORT_FILE}" 2> /dev/null || true
}

write_report_header() {
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'action=%s\n' "${ACTION}"
        printf 'proxy_mode=%s\n' "${PROXY_MODE}"
        printf 'proxy_mode_raw=%s\n' "${PROXY_MODE_RAW}"
        printf 'proxy_host=%s\n' "${PROXY_HOST}"
        printf 'proxy_port=%s\n' "${PROXY_PORT}"
        printf 'proxy_url=%s\n' "${PROXY_URL}"
        printf 'probe_url_source=%s\n' "${PROBE_URL_SOURCE}"
        printf 'probe_url_count=%s\n' "${PROBE_URL_COUNT}"
        printf 'probe_urls=%s\n' "${PROBE_URLS}"
        printf 'endpoint_registry_canonical_file=%s\n' "${ENDPOINT_REGISTRY_CANONICAL_FILE}"
        printf 'endpoint_registry_legacy_file=%s\n' "${ENDPOINT_REGISTRY_LEGACY_FILE}"
        printf 'endpoint_registry_file=%s\n' "${PROBE_REGISTRY_FILE}"
        printf 'endpoint_registry_status=%s\n' "${PROBE_REGISTRY_STATUS}"
        printf 'endpoint_registry_rows=%s\n' "${PROBE_REGISTRY_ROWS}"
        printf 'endpoint_registry_bad_rows=%s\n' "${PROBE_REGISTRY_BAD_ROWS}"
        printf 'allow_custom_probe_urls=%s\n' "${ALLOW_CUSTOM_PROBE_URLS}"
        printf 'apply_profile=%s\n' "${APPLY_PROFILE}"
        printf 'allow_non_loopback=%s\n' "${ALLOW_NON_LOOPBACK}"
        printf 'connect_ports=%s\n' "${CONNECT_PORTS}"
        printf 'runtime_dir=%s\n' "${RUNTIME_DIR}"
        printf 'tinyproxy_conf=%s\n' "${TINYPROXY_CONF}"
        printf 'pid_file=%s\n' "${TINYPROXY_PID_FILE}"
        printf 'log_file=%s\n' "${TINYPROXY_LOG_FILE}"
        printf 'status_file=%s\n' "${STATUS_FILE}"
        printf 'summary_file=%s\n' "${SUMMARY_FILE}"
        printf 'metrics_file=%s\n' "${METRICS_FILE}"
        printf 'benchmark_file=%s\n' "${BENCHMARK_FILE}"
        printf 'benchmark_summary_file=%s\n' "${BENCHMARK_SUMMARY_FILE}"
        printf 'comparison_file=%s\n' "${COMPARISON_FILE}"
        printf 'recommendation_file=%s\n' "${RECOMMENDATION_FILE}"
        printf 'lock_file=%s\n' "${LOCK_FILE}"
        printf 'lock_wait_seconds=%s\n' "${LOCK_WAIT_SECONDS}"
        printf 'status_strict=%s\n' "${STATUS_STRICT}"
        printf 'benchmark_duration_seconds=%s\n' "${BENCHMARK_DURATION_SECONDS}"
        printf 'benchmark_interval_seconds=%s\n' "${BENCHMARK_INTERVAL_SECONDS}"
        printf 'benchmark_max_samples=%s\n' "${BENCHMARK_MAX_SAMPLES}"
        printf 'benchmark_min_samples=%s\n' "${BENCHMARK_MIN_SAMPLES}"
        printf 'benchmark_max_fail_rate_percent=%s\n' "${BENCHMARK_MAX_FAIL_RATE_PERCENT}"
        printf 'benchmark_min_improvement_percent=%s\n' "${BENCHMARK_MIN_IMPROVEMENT_PERCENT}"
        printf '\n'
    } | write_atomic_content "${REPORT_FILE}" 0644 || true
}

write_metrics_header() {
    printf 'timestamp\tproxy_url\tprobe_url\thttp_code\tremote_ip\tdns_ms\ttcp_ms\ttls_ms\tttfb_ms\ttotal_ms\ttls_verify\tcurl_exitcode\tresult\treason\n' \
        | write_atomic_content "${METRICS_FILE}" 0644 || true
}

append_metric() {
    ensure_parent_dir "${METRICS_FILE}"
    printf '%s\n' "$*" >> "${METRICS_FILE}" 2> /dev/null || true
}

write_summary() {
    local status reason
    status="${1:-unknown}"
    reason="${2:-${LAST_REASON:-none}}"
    {
        printf 'status=%s\n' "${status}"
        printf 'reason=%s\n' "$(sanitize_oneline "${reason}")"
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'action=%s\n' "${ACTION}"
        printf 'mode=%s\n' "${PROXY_MODE}"
        printf 'proxy_url=%s\n' "${PROXY_URL}"
        printf 'probe_url_source=%s\n' "${PROBE_URL_SOURCE}"
        printf 'probe_url_count=%s\n' "${PROBE_URL_COUNT}"
        printf 'endpoint_registry_canonical_file=%s\n' "${ENDPOINT_REGISTRY_CANONICAL_FILE}"
        printf 'endpoint_registry_legacy_file=%s\n' "${ENDPOINT_REGISTRY_LEGACY_FILE}"
        printf 'endpoint_registry_file=%s\n' "${PROBE_REGISTRY_FILE}"
        printf 'endpoint_registry_status=%s\n' "${PROBE_REGISTRY_STATUS}"
        printf 'endpoint_registry_rows=%s\n' "${PROBE_REGISTRY_ROWS}"
        printf 'endpoint_registry_bad_rows=%s\n' "${PROBE_REGISTRY_BAD_ROWS}"
        printf 'allow_custom_probe_urls=%s\n' "${ALLOW_CUSTOM_PROBE_URLS}"
        printf 'proxy_host=%s\n' "${PROXY_HOST}"
        printf 'proxy_port=%s\n' "${PROXY_PORT}"
        printf 'connect_ports=%s\n' "${CONNECT_PORTS}"
        printf 'tinyproxy_available=%s\n' "$(cmd_available_word tinyproxy)"
        printf 'tinyproxy_version=%s\n' "$(sanitize_oneline "${TINYPROXY_VERSION}")"
        printf 'pid=%s\n' "${LAST_PID:-unknown}"
        printf 'listen_status=%s\n' "${LISTEN_STATUS:-unknown}"
        printf 'probe_status=%s\n' "${PROBE_OVERALL:-not-run}"
        printf 'probe_ok_count=%s\n' "${PROBE_OK_COUNT:-0}"
        printf 'probe_total_count=%s\n' "${PROBE_TOTAL_COUNT:-0}"
        printf 'last_http_code=%s\n' "${LAST_HTTP_CODE:-000}"
        printf 'last_remote_ip=%s\n' "${LAST_REMOTE_IP:-unknown}"
        printf 'last_total_ms=%s\n' "${LAST_TOTAL_MS:-0}"
        printf 'env_hint_ready=%s\n' "${ENV_HINT_READY:-0}"
        printf 'env_file=%s\n' "${ENV_FILE}"
        printf 'vscode_settings_hint=%s\n' "${VSCODE_SETTINGS_HINT_FILE}"
        printf 'profile_file=%s\n' "${PROFILE_FILE}"
        printf 'config_file=%s\n' "${TINYPROXY_CONF}"
        printf 'pid_file=%s\n' "${TINYPROXY_PID_FILE}"
        printf 'log_file=%s\n' "${TINYPROXY_LOG_FILE}"
        printf 'report=%s\n' "${REPORT_FILE}"
        printf 'metrics=%s\n' "${METRICS_FILE}"
        printf 'benchmark=%s\n' "${BENCHMARK_FILE}"
        printf 'benchmark_summary=%s\n' "${BENCHMARK_SUMMARY_FILE}"
        printf 'comparison=%s\n' "${COMPARISON_FILE}"
        printf 'recommendation=%s\n' "${RECOMMENDATION_FILE}"
        printf 'benchmark_status=%s\n' "${BENCHMARK_STATUS:-not-run}"
        printf 'benchmark_samples=%s\n' "${BENCHMARK_SAMPLES:-0}"
        printf 'comparison_status=%s\n' "${COMPARISON_STATUS:-not-run}"
        printf 'recommendation_action=%s\n' "${RECOMMENDATION_ACTION:-none}"
        printf 'lock_file=%s\n' "${LOCK_FILE}"
        printf 'lock_wait_seconds=%s\n' "${LOCK_WAIT_SECONDS}"
        printf 'lock_status=%s\n' "${LOCK_STATUS:-not-checked}"
        printf 'lock_diagnostics=%s\n' "$(sanitize_oneline "${LOCK_DIAGNOSTICS:-none}")"
        printf 'completed_at=%s\n' "$(ts)"
    } | write_atomic_content "${SUMMARY_FILE}" 0644 || true
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

safe_remove_file() {
    local path="${1:-}"
    [[ -n "${path}" && "${path}" != "/dev/null" ]] || return 0
    rm -f "${path}" 2> /dev/null || true
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

is_ipv4_literal() {
    awk -v ip="${1:-}" 'BEGIN {
        n=split(ip,a,"."); if (n != 4) exit 1;
        for (i=1;i<=4;i++) {
            if (a[i] !~ /^[0-9]+$/) exit 1;
            if (a[i] < 0 || a[i] > 255) exit 1;
        }
        exit 0;
    }' 2> /dev/null
}

is_loopback_host() {
    local h="${1:-}"
    case "${h}" in
        localhost | ::1) return 0 ;;
        127.*)
            is_ipv4_literal "${h}"
            return $?
            ;;
        *) return 1 ;;
    esac
}

is_safe_bind_host() {
    local host="${1:-}"
    [[ -n "${host}" && ${#host} -le 253 ]] || return 1
    case "${host}" in
        *[!A-Za-z0-9._:-]*) return 1 ;;
        .* | *..*) return 1 ;;
        0.0.0.0 | ::)
            if [[ "${ALLOW_NON_LOOPBACK}" == "true" ]]; then
                return 0
            fi
            return 1
            ;;
        *) return 0 ;;
    esac
}

json_escape() {
    local value="${1:-}"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//$'\n'/ }"
    value="${value//$'\r'/ }"
    value="${value//$'\t'/ }"
    printf '%s' "${value}"
}

shell_double_quote_value() {
    local value="${1:-}"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//$'\n'/}"
    value="${value//$'\r'/}"
    printf '"%s"' "${value}"
}

detect_tinyproxy_version() {
    local out
    if ! has_cmd tinyproxy; then
        printf 'missing'
        return 0
    fi
    out="$(tinyproxy -v 2>&1 | head -n 1 || true)"
    [[ -n "${out}" ]] || out="available"
    printf '%s' "$(sanitize_oneline "${out}")"
}

is_probably_our_tinyproxy_process() {
    local pid exe cmdline
    pid="${1:-}"
    [[ "${pid}" =~ ^[0-9]+$ ]] || return 1

    if [[ -r "/proc/${pid}/comm" ]]; then
        exe="$(awk 'NR==1{print; exit}' "/proc/${pid}/comm" 2> /dev/null || true)"
        case "${exe}" in
            tinyproxy) : ;;
            *) return 1 ;;
        esac
    fi

    if [[ -r "/proc/${pid}/cmdline" ]]; then
        cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2> /dev/null || true)"
        [[ "${cmdline}" == *tinyproxy* && "${cmdline}" == *"${TINYPROXY_CONF}"* ]] && return 0
        return 1
    fi

    return 0
}

pid_is_alive() {
    local pid
    pid="${1:-}"
    [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
    kill -0 "${pid}" 2> /dev/null
}

read_proxy_pid() {
    if [[ -s "${TINYPROXY_PID_FILE}" ]]; then
        awk 'NR==1 && $1 ~ /^[0-9]+$/ {print $1; exit}' "${TINYPROXY_PID_FILE}" 2> /dev/null
    fi
}

find_managed_tinyproxy_pid() {
    local pid cmd
    pid="$(read_proxy_pid)"
    if pid_is_alive "${pid}" && is_probably_our_tinyproxy_process "${pid}"; then
        printf '%s\n' "${pid}"
        return 0
    fi

    if has_cmd ps; then
        while IFS= read -r line; do
            pid="${line%% *}"
            cmd="${line#* }"
            [[ "${pid}" =~ ^[0-9]+$ ]] || continue
            [[ "${cmd}" == *tinyproxy* && "${cmd}" == *"${TINYPROXY_CONF}"* ]] || continue
            printf '%s\n' "${pid}"
            return 0
        done < <(ps -eo pid=,args= 2> /dev/null || true)
    fi

    return 1
}

proxy_is_running() {
    local pid
    pid="$(find_managed_tinyproxy_pid 2> /dev/null || true)"
    if [[ -n "${pid}" ]]; then
        LAST_PID="${pid}"
        return 0
    fi
    LAST_PID="unknown"
    return 1
}

cleanup_stale_pid_file() {
    local pid
    pid="$(read_proxy_pid)"
    [[ -n "${pid}" ]] || return 0
    if ! pid_is_alive "${pid}" || ! is_probably_our_tinyproxy_process "${pid}"; then
        safe_remove_file "${TINYPROXY_PID_FILE}"
        append_report "stale_pid_removed=${pid}"
    fi
}

refresh_listen_status() {
    LISTEN_STATUS="unknown"
    if has_cmd ss; then
        if ss -H -ltn 2> /dev/null | awk -v port=":${PROXY_PORT}" '$4 ~ port"$" {found=1} END {exit found ? 0 : 1}'; then
            LISTEN_STATUS="listening"
            return 0
        fi
        LISTEN_STATUS="not-listening"
        return 1
    fi
    if has_cmd netstat; then
        if netstat -ltn 2> /dev/null | awk -v port=":${PROXY_PORT}" '$4 ~ port"$" {found=1} END {exit found ? 0 : 1}'; then
            LISTEN_STATUS="listening"
            return 0
        fi
        LISTEN_STATUS="not-listening"
        return 1
    fi
    return 1
}

port_in_use() {
    refresh_listen_status
    [[ "${LISTEN_STATUS}" == "listening" ]]
}

rotate_log_if_needed() {
    local file max backup
    file="${1:-}"
    max="${2:-0}"
    [[ -n "${file}" && "${max}" =~ ^[0-9]+$ && "${max}" -gt 0 ]] || return 0
    [[ -f "${file}" ]] || return 0
    if has_cmd stat; then
        local size
        size="$(stat -c '%s' "${file}" 2> /dev/null || printf '0')"
        if [[ "${size}" =~ ^[0-9]+$ && "${size}" -gt "${max}" ]]; then
            backup="${file}.1"
            mv -f "${file}" "${backup}" 2> /dev/null || true
            : > "${file}" 2> /dev/null || true
            chmod 0600 "${file}" 2> /dev/null || true
            append_report "log_rotated=${file} previous=${backup} previous_size=${size}"
        fi
    fi
}

prepare_runtime_dir() {
    mkdir -p "${RUNTIME_DIR}" 2> /dev/null || return 1
    chmod 0700 "${RUNTIME_DIR}" 2> /dev/null || true
    rotate_log_if_needed "${TINYPROXY_LOG_FILE}" "${BENCHMARK_LOG_MAX_BYTES}"
    : > "${TINYPROXY_LOG_FILE}" 2> /dev/null || touch "${TINYPROXY_LOG_FILE}" 2> /dev/null || true
    chmod 0600 "${TINYPROXY_LOG_FILE}" 2> /dev/null || true
    return 0
}

detect_root_drop_identity() {
    local user group

    if [[ "$(id -u 2> /dev/null || echo 1)" != "0" ]]; then
        return 0
    fi

    if getent passwd tinyproxy > /dev/null 2>&1 && getent group tinyproxy > /dev/null 2>&1; then
        user="tinyproxy"
        group="tinyproxy"
    elif getent passwd nobody > /dev/null 2>&1; then
        user="nobody"
        if getent group nogroup > /dev/null 2>&1; then
            group="nogroup"
        else
            group="nobody"
        fi
    else
        return 0
    fi

    printf '%s:%s\n' "${user}" "${group}"
}

# -----------------------------------------------------------------------------
# tinyproxy lifecycle
# -----------------------------------------------------------------------------
write_tinyproxy_config() {
    local tmp identity drop_user drop_group port disable_via

    prepare_runtime_dir || return 1
    tmp="$(make_temp_file tinyproxy.conf "${RUNTIME_DIR}")"
    [[ -n "${tmp}" ]] || return 1

    identity="$(detect_root_drop_identity)"
    drop_user=""
    drop_group=""
    if [[ "${identity}" == *:* ]]; then
        drop_user="${identity%%:*}"
        drop_group="${identity#*:}"
        chown "${drop_user}:${drop_group}" "${RUNTIME_DIR}" "${TINYPROXY_LOG_FILE}" 2> /dev/null || true
    fi

    if [[ "${DISABLE_VIA_HEADER}" == "true" ]]; then
        disable_via="Yes"
    else
        disable_via="No"
    fi

    {
        printf '# Generated by %s v%s at %s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
        printf '# Loopback-only local HTTP CONNECT proxy for DevContainer GitHub/Copilot diagnostics.\n'
        if [[ -n "${drop_user}" && -n "${drop_group}" ]]; then
            printf 'User %s\n' "${drop_user}"
            printf 'Group %s\n' "${drop_group}"
        fi
        printf 'Port %s\n' "${PROXY_PORT}"
        printf 'Listen %s\n' "${PROXY_HOST}"
        printf 'Timeout %s\n' "${TINYPROXY_TIMEOUT_SECONDS}"
        printf 'LogFile "%s"\n' "${TINYPROXY_LOG_FILE}"
        printf 'LogLevel %s\n' "${TINYPROXY_LOG_LEVEL}"
        printf 'PidFile "%s"\n' "${TINYPROXY_PID_FILE}"
        printf 'MaxClients %s\n' "${TINYPROXY_MAX_CLIENTS}"
        printf 'StartServers %s\n' "${TINYPROXY_START_SERVERS}"
        printf 'MinSpareServers %s\n' "${TINYPROXY_MIN_SPARE}"
        printf 'MaxSpareServers %s\n' "${TINYPROXY_MAX_SPARE}"
        printf 'MaxRequestsPerChild 0\n'
        printf 'Allow 127.0.0.1\n'
        printf 'Allow ::1\n'
        printf 'ViaProxyName "devcontainer-copilot-proxy"\n'
        printf 'DisableViaHeader %s\n' "${disable_via}"
        while IFS= read -r port; do
            [[ -n "${port}" ]] || continue
            printf 'ConnectPort %s\n' "${port}"
        done < <(space_list_to_lines "${CONNECT_PORTS}")
    } > "${tmp}" 2> /dev/null || {
        safe_remove_file "${tmp}"
        return 1
    }

    mv -f "${tmp}" "${TINYPROXY_CONF}" 2> /dev/null || {
        safe_remove_file "${tmp}"
        return 1
    }
    chmod 0600 "${TINYPROXY_CONF}" 2> /dev/null || true
    if [[ -n "${drop_user}" && -n "${drop_group}" ]]; then
        chown "${drop_user}:${drop_group}" "${TINYPROXY_CONF}" 2> /dev/null || true
    fi
    append_report "tinyproxy_conf=${TINYPROXY_CONF}"
    append_report "tinyproxy_identity=${identity:-current-user}"
    return 0
}

preflight_safety() {
    if [[ "${PROXY_MODE}" == "off" ]]; then
        LAST_REASON="mode-off"
        return 0
    fi

    if ! is_safe_bind_host "${PROXY_HOST}"; then
        log_warn "bind host inválido/arriscado: ${PROXY_HOST}."
        append_report "result=unsafe-bind-token host=${PROXY_HOST}"
        write_status "degraded"
        LAST_REASON="unsafe-bind-token"
        return 1
    fi

    if ! is_loopback_host "${PROXY_HOST}" && [[ "${ALLOW_NON_LOOPBACK}" != "true" ]]; then
        log_warn "bind recusado: ${PROXY_HOST}. Use somente loopback ou DEVCONTAINER_LOCAL_COPILOT_PROXY_ALLOW_NON_LOOPBACK=true."
        append_report "result=unsafe-bind host=${PROXY_HOST}"
        write_status "degraded"
        LAST_REASON="unsafe-bind"
        return 1
    fi

    return 0
}

start_proxy() {
    local pid start_epoch now elapsed

    preflight_safety || return 1

    if [[ "${PROXY_MODE}" == "off" ]]; then
        log_info "proxy local Copilot desligado por mode=off."
        write_status "off"
        append_report "result=off"
        LAST_REASON="mode-off"
        return 0
    fi

    TINYPROXY_VERSION="$(detect_tinyproxy_version)"
    if ! has_cmd tinyproxy; then
        if [[ "${PROXY_MODE}" == "auto" ]]; then
            log_info "tinyproxy não encontrado; modo auto ignora proxy local."
            append_report "result=auto-no-tinyproxy"
            write_status "off"
            LAST_REASON="auto-no-tinyproxy"
            return 0
        fi
        log_warn "tinyproxy não encontrado. Instale tinyproxy no Dockerfile para usar proxy local."
        append_report "result=no-tinyproxy"
        write_status "degraded"
        LAST_REASON="no-tinyproxy"
        return 1
    fi

    cleanup_stale_pid_file
    if proxy_is_running; then
        log_info "tinyproxy já está em execução em ${PROXY_URL}."
        write_status "running"
        append_report "tinyproxy=already-running pid=${LAST_PID}"
        LAST_REASON="already-running"
        return 0
    fi

    if port_in_use; then
        log_warn "porta ${PROXY_PORT} já está em uso e não parece pertencer ao tinyproxy gerenciado."
        append_report "result=port-conflict port=${PROXY_PORT}"
        write_status "conflict"
        LAST_REASON="port-conflict"
        return 1
    fi

    write_tinyproxy_config || {
        log_warn "falha ao gerar configuração do tinyproxy."
        append_report "result=config-failed"
        write_status "degraded"
        LAST_REASON="config-failed"
        return 1
    }

    safe_remove_file "${TINYPROXY_PID_FILE}"
    # Close the control-plane lock FD in the long-running child. Without this,
    # tinyproxy inherits fd 9 from with_lock_or_run(), keeping the advisory flock
    # held after the parent script exits and causing later compare/status actions
    # to fail with lock timeout while the proxy is healthy.
    tinyproxy -d -c "${TINYPROXY_CONF}" 9>&- > /dev/null 2>> "${TINYPROXY_LOG_FILE}" &
    pid="$!"
    printf '%s\n' "${pid}" > "${TINYPROXY_PID_FILE}" 2> /dev/null || true

    start_epoch="$(date '+%s' 2> /dev/null || printf '0')"
    while true; do
        if proxy_is_running; then
            refresh_listen_status || true
            log_ok "tinyproxy ativo em ${PROXY_URL}."
            write_status "running"
            append_report "tinyproxy=running pid=${LAST_PID} listen_status=${LISTEN_STATUS}"
            LAST_REASON="started"
            return 0
        fi

        now="$(date '+%s' 2> /dev/null || printf '0')"
        elapsed=$((now - start_epoch))
        if ((elapsed >= START_WAIT_SECONDS)); then
            break
        fi
        sleep 0.2
    done

    log_warn "tinyproxy não ficou ativo. Veja ${TINYPROXY_LOG_FILE}."
    append_report "tinyproxy=not-running log=${TINYPROXY_LOG_FILE}"
    write_status "degraded"
    LAST_REASON="not-running-after-start"
    return 1
}

stop_proxy() {
    local pid attempt

    cleanup_stale_pid_file
    pid="$(find_managed_tinyproxy_pid 2> /dev/null || true)"
    if [[ -n "${pid}" ]] && pid_is_alive "${pid}" && is_probably_our_tinyproxy_process "${pid}"; then
        kill "${pid}" 2> /dev/null || safe_sudo kill "${pid}" 2> /dev/null || true
        attempt=0
        while pid_is_alive "${pid}" && ((attempt < 15)); do
            sleep 0.2
            attempt=$((attempt + 1))
        done
        if pid_is_alive "${pid}"; then
            kill -TERM "${pid}" 2> /dev/null || true
            sleep 0.5
        fi
    fi

    safe_remove_file "${TINYPROXY_PID_FILE}"
    log_info "tinyproxy stop solicitado."
    append_report "result=stopped"

    if [[ "${REMOVE_PROFILE_ON_STOP}" == "true" ]]; then
        safe_sudo rm -f "${PROFILE_FILE}" 2> /dev/null || true
        append_report "profile_removed=${PROFILE_FILE}"
    fi

    refresh_listen_status || true
    write_status "stopped"
    LAST_REASON="stopped"
    return 0
}

# -----------------------------------------------------------------------------
# Probe / hints
# -----------------------------------------------------------------------------
lowercase() {
    printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'
}

probe_url_host() {
    local url without_scheme authority host
    url="${1:-}"
    without_scheme="${url#*://}"
    authority="${without_scheme%%/*}"
    if [[ "${authority}" == \[*\]* ]]; then
        host="${authority#\[}"
        host="${host%%\]*}"
    else
        host="${authority%%:*}"
    fi
    lowercase "${host}"
}

is_allowed_probe_host() {
    local host
    host="$(probe_url_host "${1:-}")"
    [[ "${ALLOW_CUSTOM_PROBE_URLS}" == "true" ]] && return 0
    case "${host}" in
        github.com | api.github.com | uploads.github.com | user-images.githubusercontent.com) return 0 ;;
        copilot-proxy.githubusercontent.com | origin-tracker.githubusercontent.com | copilot-telemetry.githubusercontent.com | collector.github.com | default.exp-tas.com | copilot-reports.github.com) return 0 ;;
        githubcopilot.com | *.githubcopilot.com) return 0 ;;
        copilot-reports-*.b01.azurefd.net) return 0 ;;
        *) return 1 ;;
    esac
}

expected_http_ok() {
    local url code without_scheme authority host path
    url="${1:-}"
    code="${2:-000}"
    is_supported_probe_url "${url}" || return 1

    without_scheme="${url#*://}"
    authority="${without_scheme%%/*}"
    path="/${without_scheme#*/}"
    if [[ "${without_scheme}" == "${authority}" ]]; then
        path="/"
    fi
    host="${authority}"
    if [[ "${host}" == \[*\]* ]]; then
        host="${host#\[}"
        host="${host%%\]*}"
    else
        host="${host%%:*}"
    fi
    host="$(lowercase "${host}")"

    case "${host}" in
        api.github.com)
            case "${path}" in
                /)
                    [[ "${code}" == "200" || "${code}" == "403" || "${code}" == "429" ]]
                    return $?
                    ;;
                /rate_limit*)
                    [[ "${code}" == "200" || "${code}" == "403" || "${code}" == "429" ]]
                    return $?
                    ;;
                /user*)
                    [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]
                    return $?
                    ;;
                /copilot_internal/*)
                    [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" || "${code}" == "404" ]]
                    return $?
                    ;;
                *)
                    [[ -n "${code}" && "${code}" != "000" ]]
                    return $?
                    ;;
            esac
            ;;
        copilot-proxy.githubusercontent.com | origin-tracker.githubusercontent.com | copilot-telemetry.githubusercontent.com | collector.github.com | default.exp-tas.com | copilot-reports.github.com | copilot-reports-*.b01.azurefd.net)
            [[ "${code}" == "200" || "${code}" == "204" || "${code}" == "400" || "${code}" == "401" || "${code}" == "403" || "${code}" == "404" || "${code}" == "405" ]]
            return $?
            ;;
        githubcopilot.com | *.githubcopilot.com)
            [[ "${code}" == "200" || "${code}" == "204" || "${code}" == "400" || "${code}" == "401" || "${code}" == "403" || "${code}" == "404" || "${code}" == "405" ]]
            return $?
            ;;
        *)
            [[ -n "${code}" && "${code}" != "000" ]]
            return $?
            ;;
    esac
}

probe_one_url() {
    local url result http_code remote_ip total tls_verify dns_time tcp_time tls_time ttfb_time curl_exitcode
    local dns_ms tcp_ms tls_ms ttfb_ms total_ms probe_result reason
    url="${1:-}"
    if ! is_supported_probe_url "${url}"; then
        append_report "proxy_probe url_rejected=$(sanitize_oneline "${url}") reason=unsupported-or-credentialed-url"
        return 1
    fi

    result="$(LC_ALL=C curl -sS -o /dev/null \
        --proxy "${PROXY_URL}" \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        -w 'http_code=%{http_code}|remote_ip=%{remote_ip}|time_namelookup=%{time_namelookup}|time_connect=%{time_connect}|time_appconnect=%{time_appconnect}|time_starttransfer=%{time_starttransfer}|time_total=%{time_total}|ssl_verify_result=%{ssl_verify_result}|exitcode=%{exitcode}' \
        "${url}" 2> /dev/null || true)"

    http_code="$(extract_field http_code "${result}")"
    remote_ip="$(extract_field remote_ip "${result}")"
    dns_time="$(extract_field time_namelookup "${result}")"
    tcp_time="$(extract_field time_connect "${result}")"
    tls_time="$(extract_field time_appconnect "${result}")"
    ttfb_time="$(extract_field time_starttransfer "${result}")"
    total="$(extract_field time_total "${result}")"
    tls_verify="$(extract_field ssl_verify_result "${result}")"
    curl_exitcode="$(extract_field exitcode "${result}")"

    dns_ms="$(float_ms "${dns_time}")"
    tcp_ms="$(float_ms "${tcp_time}")"
    tls_ms="$(float_ms "${tls_time}")"
    ttfb_ms="$(float_ms "${ttfb_time}")"
    total_ms="$(float_ms "${total}")"

    probe_result="fail"
    reason=""
    if expected_http_ok "${url}" "${http_code}" && [[ "${tls_verify}" == "0" ]]; then
        probe_result="ok"
        reason="http-and-tls-ok"
    elif [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
        probe_result="no-response"
        reason="curl-exitcode=${curl_exitcode:-unknown}"
    elif [[ "${tls_verify}" != "0" ]]; then
        probe_result="tls-error"
        reason="tls-verify=${tls_verify:-?}"
    else
        probe_result="unexpected-http"
        reason="http=${http_code:-000}"
    fi

    LAST_HTTP_CODE="${http_code:-000}"
    LAST_REMOTE_IP="${remote_ip:-unknown}"
    LAST_TOTAL_MS="${total_ms:-0}"

    append_report "proxy_probe url=$(sanitize_oneline "${url}") http=${http_code:-000} remote_ip=${remote_ip:-unknown} dns_ms=${dns_ms} tcp_ms=${tcp_ms} tls_ms=${tls_ms} ttfb_ms=${ttfb_ms} total_ms=${total_ms} tls_verify=${tls_verify:-?} curl_exitcode=${curl_exitcode:-?} result=${probe_result} reason=${reason}"
    append_metric "$(ts)	$(sanitize_tsv_field "${PROXY_URL}")	$(sanitize_tsv_field "${url}")	${http_code:-000}	${remote_ip:-unknown}	${dns_ms}	${tcp_ms}	${tls_ms}	${ttfb_ms}	${total_ms}	${tls_verify:-?}	${curl_exitcode:-?}	${probe_result}	$(sanitize_tsv_field "${reason}")"

    if [[ "${probe_result}" == "ok" ]]; then
        log_ok "proxy validado: ${url} → HTTP ${http_code} via ${PROXY_URL} (${total_ms}ms)."
        return 0
    fi

    log_warn "proxy não validou: ${url} → HTTP ${http_code:-000}, tls=${tls_verify:-?}, result=${probe_result}."
    return 1
}

probe_proxy() {
    local url ok_count fail_count total_count
    ok_count=0
    fail_count=0
    total_count=0

    if ! has_cmd curl; then
        log_warn "curl não encontrado; não é possível testar proxy."
        append_report "result=no-curl"
        PROBE_OVERALL="degraded"
        LAST_REASON="no-curl"
        return 1
    fi

    while IFS= read -r url; do
        [[ -n "${url}" ]] || continue
        total_count=$((total_count + 1))
        if probe_one_url "${url}"; then
            ok_count=$((ok_count + 1))
        else
            fail_count=$((fail_count + 1))
        fi
    done < <(space_list_to_lines "${PROBE_URLS}")

    PROBE_OK_COUNT="${ok_count}"
    PROBE_TOTAL_COUNT="${total_count}"
    if ((total_count == 0)); then
        PROBE_OVERALL="degraded"
        LAST_REASON="no-probe-urls"
        return 1
    fi
    if ((ok_count > 0 && fail_count == 0)); then
        PROBE_OVERALL="ok"
        LAST_REASON="all-probes-ok"
        return 0
    fi
    if ((ok_count > 0)); then
        PROBE_OVERALL="partial"
        LAST_REASON="partial-probes-ok"
        return 0
    fi

    PROBE_OVERALL="failed"
    LAST_REASON="all-probes-failed"
    return 1
}

write_env_hint() {
    local ready="${1:-0}" q_proxy q_no_proxy
    ENV_HINT_READY="${ready}"
    q_proxy="$(shell_double_quote_value "${PROXY_URL}")"
    q_no_proxy="$(shell_double_quote_value "${NO_PROXY_VALUE}")"

    {
        printf '# Generated by %s v%s at %s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
        printf '# Source this manually or let an explicitly opted-in hook parse it.\n'
        printf '# The local proxy is intended for HTTP proxy variables; the proxy URL itself remains http:// even for HTTPS requests.\n'
        printf 'export HTTPS_PROXY=%s\n' "${q_proxy}"
        printf 'export HTTP_PROXY=%s\n' "${q_proxy}"
        printf 'export https_proxy=%s\n' "${q_proxy}"
        printf 'export http_proxy=%s\n' "${q_proxy}"
        printf 'export NO_PROXY=%s\n' "${q_no_proxy}"
        printf 'export no_proxy=%s\n' "${q_no_proxy}"
        printf 'export DEVCONTAINER_COPILOT_PROXY_READY=%s\n' "${ready}"
        printf 'export DEVCONTAINER_COPILOT_PROXY_URL=%s\n' "${q_proxy}"
    } | write_atomic_content "${ENV_FILE}" 0600 || true
    append_report "env_hint=${ENV_FILE} ready=${ready}"

    {
        printf '{\n'
        printf '  "http.proxy": "%s",\n' "$(json_escape "${PROXY_URL}")"
        printf '  "http.proxySupport": "on",\n'
        printf '  "http.proxyStrictSSL": true\n'
        printf '}\n'
    } | write_atomic_content "${VSCODE_SETTINGS_HINT_FILE}" 0600 || true
    append_report "vscode_settings_hint=${VSCODE_SETTINGS_HINT_FILE}"

    if [[ "${APPLY_PROFILE}" == "true" ]]; then
        local tmp
        tmp="$(make_temp_file copilot-proxy-profile /tmp)"
        [[ -n "${tmp}" ]] || return 0
        {
            printf '# Generated by %s v%s at %s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
            printf '# This affects future login shells only. It cannot alter already-running VS Code extension hosts.\n'
            printf '[ -r %s ] && . %s\n' "$(shell_double_quote_value "${ENV_FILE}")" "$(shell_double_quote_value "${ENV_FILE}")"
        } > "${tmp}" 2> /dev/null || true
        safe_sudo tee "${PROFILE_FILE}" < "${tmp}" > /dev/null 2>&1 || true
        safe_sudo chmod 0644 "${PROFILE_FILE}" 2> /dev/null || true
        safe_remove_file "${tmp}"
        append_report "profile_hint=${PROFILE_FILE}"
    fi
}

status_proxy() {
    TINYPROXY_VERSION="$(detect_tinyproxy_version)"
    if [[ "${PROXY_MODE}" == "off" ]]; then
        log_info "proxy mode off."
        write_status "off"
        append_report "result=off"
        LAST_REASON="mode-off"
        write_summary "off" "mode-off"
        return 0
    fi

    preflight_safety || {
        write_summary "degraded" "${LAST_REASON}"
        return 1
    }

    cleanup_stale_pid_file
    refresh_listen_status || true
    if proxy_is_running; then
        log_ok "tinyproxy running em ${PROXY_URL}."
        write_status "ok"
        append_report "result=running pid=${LAST_PID} listen_status=${LISTEN_STATUS}"
        LAST_REASON="running"
        write_summary "ok" "running"
        return 0
    fi

    log_info "tinyproxy não está rodando."
    write_status "stopped"
    append_report "result=stopped listen_status=${LISTEN_STATUS}"
    LAST_REASON="stopped"
    write_summary "stopped" "stopped"
    if [[ "${STATUS_STRICT}" == "true" ]]; then
        return 1
    fi
    return 0
}

doctor_action() {
    local rc
    rc=0
    TINYPROXY_VERSION="$(detect_tinyproxy_version)"
    preflight_safety || rc=1
    if ! has_cmd tinyproxy; then
        append_report "doctor=tinyproxy-missing"
        if [[ "${PROXY_MODE}" == "local" ]]; then
            rc=1
        fi
    else
        append_report "doctor=tinyproxy-present version=$(sanitize_oneline "${TINYPROXY_VERSION}")"
    fi
    if ! has_cmd curl; then
        append_report "doctor=curl-missing"
        rc=1
    fi
    if [[ "${USE_ENDPOINT_REGISTRY}" == "true" ]]; then
        if [[ "${PROBE_REGISTRY_STATUS}" == "ok" ]]; then
            append_report "doctor=endpoint-registry-ok file=${PROBE_REGISTRY_FILE} rows=${PROBE_REGISTRY_ROWS} source=${PROBE_URL_SOURCE}"
        elif [[ "${PROBE_REGISTRY_STATUS}" == "missing" ]]; then
            append_report "doctor=endpoint-registry-missing canonical=${ENDPOINT_REGISTRY_CANONICAL_FILE} legacy=${ENDPOINT_REGISTRY_LEGACY_FILE} source=${PROBE_URL_SOURCE}"
        else
            append_report "doctor=endpoint-registry-${PROBE_REGISTRY_STATUS} file=${PROBE_REGISTRY_FILE} rows=${PROBE_REGISTRY_ROWS} bad_rows=${PROBE_REGISTRY_BAD_ROWS}"
            [[ "${PROBE_REGISTRY_STATUS}" == "invalid" ]] && rc=1
        fi
    fi
    local _probe_url _bad_probe_urls
    _bad_probe_urls=0
    while IFS= read -r _probe_url; do
        [[ -n "${_probe_url}" ]] || continue
        if ! is_supported_probe_url "${_probe_url}"; then
            append_report "doctor=probe-url-rejected url=$(sanitize_oneline "${_probe_url}") allow_custom_probe_urls=${ALLOW_CUSTOM_PROBE_URLS}"
            _bad_probe_urls=$((_bad_probe_urls + 1))
        fi
    done < <(space_list_to_lines "${PROBE_URLS}")
    if [[ "${_bad_probe_urls}" -gt 0 ]]; then
        rc=1
    fi
    append_report "doctor=probe-url-audit source=${PROBE_URL_SOURCE} count=${PROBE_URL_COUNT} rejected=${_bad_probe_urls}"
    refresh_listen_status || true
    if proxy_is_running; then
        write_status "ok"
        write_summary "ok" "doctor-running"
    elif [[ "${PROXY_MODE}" == "off" ]]; then
        write_status "off"
        write_summary "off" "doctor-mode-off"
    elif [[ "${rc}" -eq 0 ]]; then
        write_status "stopped"
        write_summary "stopped" "doctor-ready-but-stopped"
    else
        write_status "degraded"
        write_summary "degraded" "doctor-degraded"
    fi
    return "${rc}"
}

write_compare_not_run_recommendation() {
    local reason generated_epoch expires_epoch generated_at
    reason="${1:-compare-not-run}"
    generated_epoch="$(date '+%s' 2> /dev/null || printf '0')"
    expires_epoch=$((generated_epoch + BENCHMARK_RECOMMENDATION_TTL_SECONDS))
    generated_at="$(ts)"
    {
        printf '%s\n' 'scope=local-copilot-proxy'
        printf 'generated_at=%s\n' "${generated_at}"
        printf 'generated_epoch=%s\n' "${generated_epoch}"
        printf 'expires_epoch=%s\n' "${expires_epoch}"
        printf '%s\n' 'recommended_action=compare-not-run'
        printf '%s\n' 'confidence=low'
        printf 'reason=%s\n' "$(sanitize_oneline "${reason}")"
        printf '%s\n' 'total_endpoints=0'
        printf '%s\n' 'proxy_better_endpoints=0'
        printf '%s\n' 'proxy_worse_endpoints=0'
        printf '%s\n' 'proxy_breaks_endpoints=0'
        printf '%s\n' 'insufficient_endpoints=0'
        printf 'min_samples=%s\n' "${BENCHMARK_MIN_SAMPLES}"
        printf 'max_fail_rate_percent=%s\n' "${BENCHMARK_MAX_FAIL_RATE_PERCENT}"
        printf 'min_improvement_percent=%s\n' "${BENCHMARK_MIN_IMPROVEMENT_PERCENT}"
    } | write_atomic_content "${RECOMMENDATION_FILE}" 0644 || true
    RECOMMENDATION_ACTION="compare-not-run"
}

collect_lock_diagnostics() {
    local out line count
    out=""
    if [[ -e "${LOCK_FILE}" ]] && has_cmd lsof; then
        count=0
        while IFS= read -r line; do
            [[ -n "${line}" ]] || continue
            count=$((count + 1))
            line="$(sanitize_oneline "${line}")"
            if [[ -z "${out}" ]]; then
                out="lsof:${line}"
            else
                out="${out};${line}"
            fi
            ((count >= 5)) && break
        done < <(lsof -nP "${LOCK_FILE}" 2> /dev/null | awk 'NR>1 {print}' || true)
    fi
    if [[ -z "${out}" && -e "${LOCK_FILE}" ]] && has_cmd fuser; then
        out="fuser:$(sanitize_oneline "$(fuser -v "${LOCK_FILE}" 2>&1 || true)")"
    fi
    if [[ -z "${out}" ]]; then
        if [[ -e "${LOCK_FILE}" ]]; then
            out="no-holder-visible"
        else
            out="lock-file-absent"
        fi
    fi
    printf '%s' "${out}"
}

write_lock_failure_artifacts() {
    local reason status
    reason="lock-timeout-after-${LOCK_WAIT_SECONDS}s"
    status="lock-failed"
    LOCK_STATUS="failed"
    LOCK_DIAGNOSTICS="$(collect_lock_diagnostics)"
    if [[ "${ACTION}" == "compare" ]]; then
        COMPARISON_STATUS="lock-failed"
        status="compare-lock-failed"
        write_compare_not_run_recommendation "${reason}"
    elif [[ "${ACTION}" == "benchmark" ]]; then
        BENCHMARK_STATUS="lock-failed"
        status="benchmark-lock-failed"
    fi
    log_warn "não foi possível adquirir lock ${LOCK_FILE} em ${LOCK_WAIT_SECONDS}s; action=${ACTION}; diagnostics=${LOCK_DIAGNOSTICS}."
    write_status "${status}"
    write_report_header
    append_report "result=lock-failed action=${ACTION} lock_file=${LOCK_FILE} lock_wait_seconds=${LOCK_WAIT_SECONDS} diagnostics=$(sanitize_oneline "${LOCK_DIAGNOSTICS}")"
    write_summary "${status}" "${reason}"
}

with_lock_or_run() {
    local rc
    if has_cmd flock; then
        ensure_parent_dir "${LOCK_FILE}"
        (
            if [[ "${LOCK_WAIT_SECONDS}" == "0" ]]; then
                flock -x 9 || exit 98
            else
                flock -x -w "${LOCK_WAIT_SECONDS}" 9 || exit 98
            fi
            LOCK_STATUS="acquired"
            main_unlocked "$@"
        ) 9> "${LOCK_FILE}"
        rc=$?
        if [[ "${rc}" -eq 98 ]]; then
            write_lock_failure_artifacts
        fi
        return "${rc}"
    fi

    LOCK_STATUS="not-available"
    main_unlocked "$@"
}

# -----------------------------------------------------------------------------
# Benchmark / direct-vs-proxy comparison helpers
# -----------------------------------------------------------------------------
is_supported_probe_url() {
    local url without_scheme authority hostport host port
    url="${1:-}"
    [[ -n "${url}" ]] || return 1
    [[ "${url}" != *[[:space:]]* ]] || return 1
    [[ "${url}" != *\* ]] || return 1
    case "${url}" in
        https://*) : ;;
        http://*) [[ "${ALLOW_CUSTOM_PROBE_URLS}" == "true" ]] || return 1 ;;
        *) return 1 ;;
    esac
    without_scheme="${url#*://}"
    authority="${without_scheme%%/*}"
    # Probe URLs are endpoint descriptors, not credential carriers. Reject
    # userinfo-bearing URLs so credentials cannot be logged into report/TSV files.
    case "${authority}" in
        *@* | "") return 1 ;;
    esac
    hostport="${authority}"
    if [[ "${hostport}" == \[*\]* ]]; then
        host="${hostport#\[}"
        host="${host%%\]*}"
        port="${hostport##*:}"
        [[ "${hostport}" == *]:* ]] || port=""
    else
        host="${hostport%%:*}"
        port=""
        [[ "${hostport}" == *:* ]] && port="${hostport##*:}"
    fi
    [[ -n "${host}" ]] || return 1
    if [[ -n "${port}" ]]; then
        [[ "${port}" =~ ^[0-9]+$ && "${port}" -ge 1 && "${port}" -le 65535 ]] || return 1
    fi
    is_allowed_probe_host "${url}" || return 1
    return 0
}
write_benchmark_header() {
    printf 'timestamp\tsample_index\ttransport\tproxy_url\tprobe_url\thttp_code\tremote_ip\tdns_ms\ttcp_ms\ttls_ms\tttfb_ms\ttotal_ms\ttls_verify\tcurl_exitcode\tresult\treason\n' \
        | write_atomic_content "${BENCHMARK_FILE}" 0644 || true
}

transport_curl_probe() {
    local transport url sample_index result http_code remote_ip total tls_verify dns_time tcp_time tls_time ttfb_time curl_exitcode
    local dns_ms tcp_ms tls_ms ttfb_ms total_ms probe_result reason
    transport="${1:-direct}"
    url="${2:-}"
    sample_index="${3:-0}"

    if ! is_supported_probe_url "${url}"; then
        append_report "benchmark_probe_rejected transport=${transport} url=$(sanitize_oneline "${url}") reason=unsupported-or-credentialed-url"
        return 1
    fi

    local -a curl_args=()
    case "${transport}" in
        direct)
            curl_args+=(--noproxy '*')
            ;;
        proxy)
            curl_args+=(--proxy "${PROXY_URL}" --noproxy '')
            ;;
        *)
            append_report "benchmark_probe_rejected transport=${transport} reason=unknown-transport"
            return 1
            ;;
    esac

    result="$(LC_ALL=C curl -sS -o /dev/null \
        "${curl_args[@]}" \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        -w 'http_code=%{http_code}|remote_ip=%{remote_ip}|time_namelookup=%{time_namelookup}|time_connect=%{time_connect}|time_appconnect=%{time_appconnect}|time_starttransfer=%{time_starttransfer}|time_total=%{time_total}|ssl_verify_result=%{ssl_verify_result}|exitcode=%{exitcode}' \
        "${url}" 2> /dev/null || true)"

    http_code="$(extract_field http_code "${result}")"
    remote_ip="$(extract_field remote_ip "${result}")"
    dns_time="$(extract_field time_namelookup "${result}")"
    tcp_time="$(extract_field time_connect "${result}")"
    tls_time="$(extract_field time_appconnect "${result}")"
    ttfb_time="$(extract_field time_starttransfer "${result}")"
    total="$(extract_field time_total "${result}")"
    tls_verify="$(extract_field ssl_verify_result "${result}")"
    curl_exitcode="$(extract_field exitcode "${result}")"

    dns_ms="$(float_ms "${dns_time}")"
    tcp_ms="$(float_ms "${tcp_time}")"
    tls_ms="$(float_ms "${tls_time}")"
    ttfb_ms="$(float_ms "${ttfb_time}")"
    total_ms="$(float_ms "${total}")"

    probe_result="fail"
    reason=""
    if expected_http_ok "${url}" "${http_code}" && [[ "${tls_verify}" == "0" ]]; then
        probe_result="ok"
        reason="http-and-tls-ok"
    elif [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
        probe_result="no-response"
        reason="curl-exitcode=${curl_exitcode:-unknown}"
    elif [[ "${tls_verify}" != "0" ]]; then
        probe_result="tls-error"
        reason="tls-verify=${tls_verify:-?}"
    else
        probe_result="unexpected-http"
        reason="http=${http_code:-000}"
    fi

    ensure_parent_dir "${BENCHMARK_FILE}"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$(ts)" "$(sanitize_tsv_field "${sample_index}")" "$(sanitize_tsv_field "${transport}")" "$(sanitize_tsv_field "${PROXY_URL}")" \
        "$(sanitize_tsv_field "${url}")" "${http_code:-000}" "${remote_ip:-unknown}" "${dns_ms}" "${tcp_ms}" "${tls_ms}" "${ttfb_ms}" "${total_ms}" \
        "${tls_verify:-?}" "${curl_exitcode:-?}" "${probe_result}" "$(sanitize_tsv_field "${reason}")" \
        >> "${BENCHMARK_FILE}" 2> /dev/null || true

    append_report "benchmark_probe sample=${sample_index} transport=${transport} url=$(sanitize_oneline "${url}") http=${http_code:-000} remote=${remote_ip:-unknown} total_ms=${total_ms} result=${probe_result} reason=${reason}"
    if [[ "${probe_result}" == "ok" ]]; then
        return 0
    fi
    return 1
}

generate_proxy_benchmark_summary() {
    local tmp_summary generated_epoch generated_at
    tmp_summary="$(make_temp_file copilot-proxy-benchmark-summary /tmp)"
    [[ -n "${tmp_summary}" ]] || return 1
    generated_epoch="$(date '+%s' 2> /dev/null || printf '0')"
    generated_at="$(ts)"

    awk -F '\t' \
        -v generated_epoch="${generated_epoch}" \
        -v generated_at="${generated_at}" \
        -v min_samples="${BENCHMARK_MIN_SAMPLES}" \
        -v max_fail="${BENCHMARK_MAX_FAIL_RATE_PERCENT}" '
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
        NR == 1 { next }
        NF >= 16 {
            key=$3 "|" $5
            transport[key]=$3
            url[key]=$5
            total[key]++
            rows++
            if ($15 == "ok") {
                ok[key]++
                lat=$12+0
                if (lat > 0) values[key]=(values[key] == "" ? lat : values[key] "," lat)
            }
        }
        END {
            print "status=ok"
            print "generated_at=" generated_at
            print "generated_epoch=" generated_epoch
            print "sample_rows=" rows+0
            print "min_samples=" min_samples
            print "max_fail_rate_percent=" max_fail
            print "groups_begin"
            for (k in total) {
                fail_count=total[k]-(ok[k]+0)
                fail_rate=(total[k] > 0 ? fail_count*100.0/total[k] : 100)
                p50=percentile(values[k], 0.50)
                p95=percentile(values[k], 0.95)
                p99=percentile(values[k], 0.99)
                print "group=" k ";total=" total[k] ";ok=" (ok[k]+0) ";fail=" fail_count ";fail_rate_percent=" sprintf("%.2f", fail_rate) ";p50_ms=" p50 ";p95_ms=" p95 ";p99_ms=" p99
            }
            print "groups_end"
        }' "${BENCHMARK_FILE}" > "${tmp_summary}" 2> /dev/null || {
        safe_remove_file "${tmp_summary}"
        return 1
    }

    mv -f "${tmp_summary}" "${BENCHMARK_SUMMARY_FILE}" 2> /dev/null || return 1
    chmod 0644 "${BENCHMARK_SUMMARY_FILE}" 2> /dev/null || true
    return 0
}

generate_comparison_and_recommendation() {
    local tmp_comparison tmp_recommendation generated_epoch expires_epoch generated_at
    tmp_comparison="$(make_temp_file copilot-proxy-comparison /tmp)"
    tmp_recommendation="$(make_temp_file copilot-proxy-recommendation /tmp)"
    [[ -n "${tmp_comparison}" && -n "${tmp_recommendation}" ]] || return 1
    generated_epoch="$(date '+%s' 2> /dev/null || printf '0')"
    expires_epoch=$((generated_epoch + BENCHMARK_RECOMMENDATION_TTL_SECONDS))
    generated_at="$(ts)"

    awk -F '\t' \
        -v min_samples="${BENCHMARK_MIN_SAMPLES}" \
        -v max_fail="${BENCHMARK_MAX_FAIL_RATE_PERCENT}" \
        -v min_improve="${BENCHMARK_MIN_IMPROVEMENT_PERCENT}" \
        -v generated_epoch="${generated_epoch}" \
        -v expires_epoch="${expires_epoch}" \
        -v generated_at="${generated_at}" \
        -v recommendation_file="${tmp_recommendation}" '
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
        NR == 1 { next }
        NF >= 16 {
            t=$3
            endpoint=$5
            total[t,endpoint]++
            endpoints[endpoint]=1
            if ($15 == "ok") {
                ok[t,endpoint]++
                lat=$12+0
                if (lat > 0) values[t,endpoint]=(values[t,endpoint] == "" ? lat : values[t,endpoint] "," lat)
            }
        }
        END {
            print "endpoint\tdirect_total\tdirect_ok\tdirect_fail\tdirect_fail_rate_percent\tdirect_p50_ms\tdirect_p95_ms\tproxy_total\tproxy_ok\tproxy_fail\tproxy_fail_rate_percent\tproxy_p50_ms\tproxy_p95_ms\tdelta_p95_ms\tdelta_p95_percent\trecommendation\treason"

            total_endpoints=0
            proxy_better=0
            proxy_worse=0
            proxy_breaks=0
            insufficient=0
            for (endpoint in endpoints) {
                total_endpoints++
                dt=total["direct",endpoint]+0
                dok=ok["direct",endpoint]+0
                dfail=dt-dok
                dfr=(dt > 0 ? dfail*100.0/dt : 100)
                dp50=percentile(values["direct",endpoint], 0.50)
                dp95=percentile(values["direct",endpoint], 0.95)

                pt=total["proxy",endpoint]+0
                pok=ok["proxy",endpoint]+0
                pfail=pt-pok
                pfr=(pt > 0 ? pfail*100.0/pt : 100)
                pp50=percentile(values["proxy",endpoint], 0.50)
                pp95=percentile(values["proxy",endpoint], 0.95)

                rec="insufficient-samples"
                reason="min-samples-not-met"
                delta=0
                delta_pct=0
                if (dp95 > 0 && pp95 > 0) {
                    delta=pp95-dp95
                    delta_pct=(dp95 > 0 ? delta*100.0/dp95 : 0)
                }

                if (dt >= min_samples && pt >= min_samples) {
                    if (dfr <= max_fail && pfr > max_fail) {
                        rec="proxy-breaks-endpoint"; reason="proxy-fail-rate-too-high"; proxy_breaks++
                    } else if (pfr < dfr) {
                        rec="proxy-improves-stability"; reason="proxy-fail-rate-lower"; proxy_better++
                    } else if (dp95 > 0 && pp95 > 0 && pp95 <= (dp95 * (100 - min_improve) / 100) && pfr <= dfr) {
                        rec="proxy-improves-latency"; reason="proxy-p95-improved"; proxy_better++
                    } else if (dp95 > 0 && pp95 > 0 && pp95 > dp95 && pfr >= dfr) {
                        rec="proxy-adds-overhead"; reason="proxy-p95-worse"; proxy_worse++
                    } else {
                        rec="keep-direct"; reason="proxy-not-materially-better"
                    }
                } else {
                    insufficient++
                }

                print endpoint "\t" dt "\t" dok "\t" dfail "\t" sprintf("%.2f", dfr) "\t" dp50 "\t" dp95 "\t" pt "\t" pok "\t" pfail "\t" sprintf("%.2f", pfr) "\t" pp50 "\t" pp95 "\t" delta "\t" sprintf("%.2f", delta_pct) "\t" rec "\t" reason
            }

            action="keep-direct"
            reason="proxy-not-materially-better"
            confidence="medium"
            if (total_endpoints == 0 || insufficient == total_endpoints) {
                action="insufficient-samples"
                reason="no-endpoint-with-minimum-samples"
                confidence="low"
            } else if (proxy_breaks > 0) {
                action="keep-direct"
                reason="proxy-breaks-one-or-more-endpoints"
                confidence="high"
            } else if (proxy_better > 0 && proxy_worse == 0) {
                action="prefer-proxy-opt-in"
                reason="proxy-improves-without-observed-regression"
                confidence=(insufficient == 0 ? "high" : "medium")
            } else if (proxy_better > proxy_worse) {
                action="observe-more"
                reason="mixed-results-proxy-sometimes-better"
                confidence="medium"
            }

            print "scope=local-copilot-proxy" > recommendation_file
            print "generated_at=" generated_at >> recommendation_file
            print "generated_epoch=" generated_epoch >> recommendation_file
            print "expires_epoch=" expires_epoch >> recommendation_file
            print "recommended_action=" action >> recommendation_file
            print "confidence=" confidence >> recommendation_file
            print "reason=" reason >> recommendation_file
            print "total_endpoints=" total_endpoints >> recommendation_file
            print "proxy_better_endpoints=" proxy_better >> recommendation_file
            print "proxy_worse_endpoints=" proxy_worse >> recommendation_file
            print "proxy_breaks_endpoints=" proxy_breaks >> recommendation_file
            print "insufficient_endpoints=" insufficient >> recommendation_file
            print "min_samples=" min_samples >> recommendation_file
            print "max_fail_rate_percent=" max_fail >> recommendation_file
            print "min_improvement_percent=" min_improve >> recommendation_file
        }' "${BENCHMARK_FILE}" > "${tmp_comparison}" 2> /dev/null || {
        safe_remove_file "${tmp_comparison}"
        safe_remove_file "${tmp_recommendation}"
        return 1
    }

    mv -f "${tmp_comparison}" "${COMPARISON_FILE}" 2> /dev/null || return 1
    chmod 0644 "${COMPARISON_FILE}" 2> /dev/null || true
    mv -f "${tmp_recommendation}" "${RECOMMENDATION_FILE}" 2> /dev/null || return 1
    chmod 0644 "${RECOMMENDATION_FILE}" 2> /dev/null || true

    RECOMMENDATION_ACTION="$(awk -F= '$1=="recommended_action"{print $2; exit}' "${RECOMMENDATION_FILE}" 2> /dev/null || printf 'unknown')"
    return 0
}

benchmark_loop() {
    local include_direct include_proxy start_epoch now elapsed sample_index next_sleep url
    include_direct="${1:-false}"
    include_proxy="${2:-true}"

    write_benchmark_header
    start_epoch="$(date '+%s' 2> /dev/null || printf '0')"
    sample_index=0

    while true; do
        now="$(date '+%s' 2> /dev/null || printf '0')"
        elapsed=$((now - start_epoch))
        if ((sample_index > 0 && elapsed >= BENCHMARK_DURATION_SECONDS)); then
            break
        fi
        if ((BENCHMARK_MAX_SAMPLES > 0 && sample_index >= BENCHMARK_MAX_SAMPLES)); then
            break
        fi

        sample_index=$((sample_index + 1))
        log_info "benchmark sample=${sample_index}; elapsed=${elapsed}s; direct=${include_direct}; proxy=${include_proxy}."
        while IFS= read -r url; do
            [[ -n "${url}" ]] || continue
            if [[ "${include_direct}" == "true" ]]; then
                transport_curl_probe direct "${url}" "${sample_index}" || true
            fi
            if [[ "${include_proxy}" == "true" ]]; then
                transport_curl_probe proxy "${url}" "${sample_index}" || true
            fi
        done < <(space_list_to_lines "${PROBE_URLS}")

        now="$(date '+%s' 2> /dev/null || printf '0')"
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

    BENCHMARK_SAMPLES="${sample_index}"
}

ensure_proxy_for_benchmark() {
    if [[ "${PROXY_MODE}" == "off" ]]; then
        LAST_REASON="benchmark-mode-off"
        return 1
    fi
    preflight_safety || return 1
    if proxy_is_running; then
        refresh_listen_status || true
        return 0
    fi
    start_proxy || return $?
    if proxy_is_running; then
        refresh_listen_status || true
        return 0
    fi
    LAST_REASON="${LAST_REASON:-proxy-not-running-after-start}"
    return 1
}

benchmark_action() {
    local rc
    rc=0
    write_status "benchmarking"
    write_report_header
    write_metrics_header
    TINYPROXY_VERSION="$(detect_tinyproxy_version)"

    ensure_proxy_for_benchmark || {
        rc=$?
        if [[ "${PROXY_MODE}" == "auto" || "${PROXY_MODE}" == "off" ]]; then
            write_env_hint 0
            write_status "benchmark-off"
            BENCHMARK_STATUS="off"
            write_summary "off" "${LAST_REASON}"
            return 0
        fi
        write_status "benchmark-failed"
        BENCHMARK_STATUS="failed"
        write_summary "degraded" "${LAST_REASON}"
        return "${rc}"
    }

    benchmark_loop false true
    if generate_proxy_benchmark_summary; then
        BENCHMARK_STATUS="ok"
        write_status "benchmark-ok"
        write_env_hint 1
        write_summary "benchmark-ok" "benchmark-complete"
        append_report "benchmark=ok samples=${BENCHMARK_SAMPLES} benchmark_file=${BENCHMARK_FILE} benchmark_summary=${BENCHMARK_SUMMARY_FILE}"
        return 0
    fi

    BENCHMARK_STATUS="degraded"
    write_status "benchmark-degraded"
    write_summary "degraded" "benchmark-summary-failed"
    return 1
}

compare_action() {
    local proxy_was_running rc
    rc=0
    proxy_was_running="false"
    write_status "comparing"
    write_report_header
    write_metrics_header
    TINYPROXY_VERSION="$(detect_tinyproxy_version)"

    if proxy_is_running; then
        proxy_was_running="true"
    elif [[ "${COMPARE_REQUIRE_PROXY_STARTED}" == "true" ]]; then
        ensure_proxy_for_benchmark || {
            rc=$?
            if [[ "${PROXY_MODE}" == "auto" || "${PROXY_MODE}" == "off" ]]; then
                write_env_hint 0
                COMPARISON_STATUS="off"
                write_compare_not_run_recommendation "${LAST_REASON:-compare-mode-off}"
                write_status "compare-off"
                write_summary "off" "${LAST_REASON}"
                return 0
            fi
            COMPARISON_STATUS="failed"
            write_compare_not_run_recommendation "${LAST_REASON:-compare-proxy-unavailable}"
            write_status "compare-failed"
            write_summary "degraded" "${LAST_REASON}"
            return "${rc}"
        }
    else
        COMPARISON_STATUS="failed"
        write_compare_not_run_recommendation "proxy-not-running"
        write_status "compare-failed"
        write_summary "degraded" "proxy-not-running"
        return 1
    fi

    benchmark_loop true true
    generate_proxy_benchmark_summary || rc=1
    generate_comparison_and_recommendation || rc=1

    if [[ "${proxy_was_running}" != "true" && "${COMPARE_KEEP_PROXY_AFTER_RUN}" != "true" ]]; then
        stop_proxy || true
        write_env_hint 0
    else
        write_env_hint 1
    fi

    if [[ "${rc}" -eq 0 ]]; then
        COMPARISON_STATUS="ok"
        BENCHMARK_STATUS="ok"
        write_status "compare-ok"
        write_summary "compare-ok" "compare-complete"
        append_report "compare=ok samples=${BENCHMARK_SAMPLES} comparison=${COMPARISON_FILE} recommendation=${RECOMMENDATION_FILE}"
        return 0
    fi

    COMPARISON_STATUS="degraded"
    write_status "compare-degraded"
    write_summary "degraded" "compare-summary-failed"
    return 1
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main_unlocked() {
    local rc
    write_report_header
    write_metrics_header
    TINYPROXY_VERSION="$(detect_tinyproxy_version)"
    log_info "Local Copilot proxy manager iniciado (v${SCRIPT_VERSION}); action=${ACTION}; mode=${PROXY_MODE}."
    log_debug "PROXY_URL=${PROXY_URL}; PROBE_URL_SOURCE=${PROBE_URL_SOURCE}; PROBE_URL_COUNT=${PROBE_URL_COUNT}"
    log_debug "RUNTIME_DIR=${RUNTIME_DIR}"
    log_debug "CONNECT_PORTS=${CONNECT_PORTS}"

    case "${ACTION}" in
        stop)
            stop_proxy
            write_env_hint 0
            write_summary "stopped" "stopped"
            return 0
            ;;
        status)
            status_proxy
            return $?
            ;;
        env)
            if proxy_is_running; then
                write_env_hint 1
                write_status "env-only"
                write_summary "env-only" "env-hint-running"
            else
                write_env_hint 0
                write_status "env-only"
                write_summary "env-only" "env-hint-not-running"
            fi
            append_report "result=env-only"
            return 0
            ;;
        doctor)
            doctor_action
            return $?
            ;;
        benchmark)
            benchmark_action
            return $?
            ;;
        compare)
            compare_action
            return $?
            ;;
        restart)
            stop_proxy || true
            ;;
        probe)
            if [[ "${PROXY_MODE}" == "off" ]]; then
                write_status "off"
                write_summary "off" "probe-mode-off"
                return 0
            fi
            preflight_safety || {
                write_summary "degraded" "${LAST_REASON}"
                return 1
            }
            if ! proxy_is_running; then
                log_warn "proxy não está rodando; action=probe requer instância ativa."
                write_status "stopped"
                write_summary "stopped" "probe-not-running"
                return 1
            fi
            probe_proxy
            rc=$?
            if [[ "${rc}" -eq 0 ]]; then
                write_status "ok"
                write_env_hint 1
                write_summary "ok" "${LAST_REASON}"
            else
                write_status "degraded"
                write_summary "degraded" "${LAST_REASON}"
            fi
            return "${rc}"
            ;;
    esac

    start_proxy || {
        rc=$?
        if [[ "${PROXY_MODE}" == "auto" ]]; then
            write_env_hint 0
            write_summary "off" "${LAST_REASON}"
            return 0
        fi
        write_summary "degraded" "${LAST_REASON}"
        return "${rc}"
    }

    if [[ "${PROXY_MODE}" == "off" ]]; then
        write_env_hint 0
        write_summary "off" "mode-off"
        return 0
    fi
    if [[ -s "${STATUS_FILE}" ]] && grep -qx 'off' "${STATUS_FILE}" 2> /dev/null; then
        append_report "result=optional-proxy-skipped"
        write_env_hint 0
        write_summary "off" "optional-proxy-skipped"
        return 0
    fi

    probe_proxy || {
        write_status "degraded"
        write_env_hint 0
        append_report "result=probe-failed"
        write_summary "degraded" "${LAST_REASON}"
        if [[ "${PROXY_MODE}" == "auto" ]]; then
            return 0
        fi
        return 1
    }

    write_env_hint 1
    write_status "ok"
    append_report "result=ok proxy_url=${PROXY_URL}"
    write_summary "ok" "${LAST_REASON}"
    log_ok "Proxy local Copilot pronto. Para shells futuros: source ${ENV_FILE}"
    return 0
}

main() {
    with_lock_or_run "$@"
    return $?
}

main "$@"
exit $?
