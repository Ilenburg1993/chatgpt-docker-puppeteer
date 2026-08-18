#!/usr/bin/env bash
# =============================================================================
# network-control-plane-state.sh — Passive Network/Copilot Control Plane State
# Version: v1.1.1
#
# Purpose:
#   Aggregate the local DevContainer network/Copilot control-plane artifacts into
#   a single coherent state without running external probes or mutating runtime
#   network configuration.
#
# Contract:
#   - Read-only with respect to network/DNS/proxy/hosts/Docker/DevContainer.
#   - Writes only its own /tmp/devcontainer-network-control-plane.* artifacts.
#   - Consumes post-create, post-start, DNS, route-fix, manager, proxy, advisor,
#     healthcheck and sync-local-auth summaries without triggering them.
#   - Never starts/stops dnsmasq, tinyproxy, PM2, Chrome proxy or app services.
#   - Never executes curl/dig/getent/gh/npm/make/docker/sudo.
#   - Treats /etc/resolv.conf as current runtime fact for DNS drift detection.
#   - Separates runtime route state from action/benchmark artifacts.
#   - Exits 0 by default even when state is degraded; --strict makes degraded+
#     return non-zero for manual validation/CI.
#
# v1.1.1 focus:
#   - Separa presença de artifact de autoridade temporal: route summaries stale
#     permanecem evidência histórica/advisory, mas não governam o runtime atual.
#   - Mantém degradação para contrato realmente violado em artifact fresco
#     (por exemplo benchmark/action publicado como runtime summary).
#   - Expõe route_authority_state no summary para tornar a decisão auditável.
# =============================================================================

set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

SCRIPT_NAME="network-control-plane-state.sh"
SCRIPT_VERSION="1.1.1"

ACTION="summary"
STRICT_MODE="false"
QUIET="false"
NO_WRITE="false"
FORMAT="human"

while [[ $# -gt 0 ]]; do
    case "${1:-}" in
        --version)
            printf '%s v%s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}"
            exit 0
            ;;
        --help)
            cat << 'USAGE'
network-control-plane-state.sh [--help] [--version] [--strict] [--quiet] [--no-write] [summary|status|report|events|json|doctor]

Passive aggregator for DevContainer network/Copilot control-plane artifacts.
It reads local summaries/status files and current /etc/resolv.conf, writes only
its own /tmp/devcontainer-network-control-plane.* artifacts, and never executes
network probes or mutates DNS, /etc/hosts, proxy, Docker or DevContainer state.

Actions:
  summary  Print concise human summary and write artifacts. Default.
  status   Print only the consolidated status.
  report   Print the generated report.
  events   Print event TSV.
  json     Print generated JSON state.
  doctor   Validate local artifact contract, still without network probes.

Options:
  --quiet     Suppress human output, still write artifacts.
  --no-write  Do not write artifacts; use a temporary in-memory/event file.
  --strict    Exit 1 when consolidated status is degraded, failed or fatal.
  --format=human|json  For summary/doctor, choose human output or JSON output.
USAGE
            exit 0
            ;;
        --strict)
            STRICT_MODE="true"
            shift
            ;;
        --quiet)
            QUIET="true"
            shift
            ;;
        --no-write)
            NO_WRITE="true"
            shift
            ;;
        --format=*)
            FORMAT="${1#--format=}"
            shift
            ;;
        summary | status | report | events | json | doctor)
            ACTION="$1"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------------
PROJECT_ROOT="${DEVCONTAINER_PROJECT_ROOT:-${PWD:-}}"
if [[ -z "${PROJECT_ROOT}" || ! -d "${PROJECT_ROOT}" ]]; then
    PROJECT_ROOT="$(pwd -P 2> /dev/null || printf '.')"
fi

STATUS_OUT="${DEVCONTAINER_NETWORK_CONTROL_PLANE_STATUS_FILE:-/tmp/devcontainer-network-control-plane.status}"
SUMMARY_OUT="${DEVCONTAINER_NETWORK_CONTROL_PLANE_SUMMARY_FILE:-/tmp/devcontainer-network-control-plane.summary}"
REPORT_OUT="${DEVCONTAINER_NETWORK_CONTROL_PLANE_REPORT_FILE:-/tmp/devcontainer-network-control-plane.report}"
EVENTS_OUT="${DEVCONTAINER_NETWORK_CONTROL_PLANE_EVENTS_FILE:-/tmp/devcontainer-network-control-plane.events.tsv}"
JSON_OUT="${DEVCONTAINER_NETWORK_CONTROL_PLANE_JSON_FILE:-/tmp/devcontainer-network-control-plane.state.json}"
LOCK_FILE="${DEVCONTAINER_NETWORK_CONTROL_PLANE_LOCK_FILE:-/tmp/devcontainer-network-control-plane.lock}"
LOCK_WAIT_SECONDS="${DEVCONTAINER_NETWORK_CONTROL_PLANE_LOCK_WAIT_SECONDS:-2}"
MAX_AGE_SECONDS="${DEVCONTAINER_NETWORK_CONTROL_PLANE_MAX_AGE_SECONDS:-86400}"

STATE_MANIFEST="${DEVCONTAINER_STATE_MANIFEST:-${PROJECT_ROOT%/}/.devcontainer/.initialized}"
HEALTH_STATUS="${DEVCONTAINER_HEALTH_STATUS_FILE:-/tmp/devcontainer-health.status}"
HEALTH_SUMMARY="${DEVCONTAINER_HEALTH_SUMMARY_FILE:-/tmp/devcontainer-health.summary}"
HEALTH_REPORT="${DEVCONTAINER_HEALTH_REPORT_FILE:-/tmp/devcontainer-health.report}"
HEALTH_EVENTS="${DEVCONTAINER_HEALTH_EVENTS_FILE:-/tmp/devcontainer-health.events.tsv}"
SYNC_LOCAL_AUTH_STATUS="${DEVCONTAINER_SYNC_LOCAL_AUTH_STATUS_FILE:-/tmp/devcontainer-sync-local-auth.status}"
SYNC_LOCAL_AUTH_SUMMARY="${DEVCONTAINER_SYNC_LOCAL_AUTH_SUMMARY_FILE:-/tmp/devcontainer-sync-local-auth.summary}"
SYNC_LOCAL_AUTH_REPORT="${DEVCONTAINER_SYNC_LOCAL_AUTH_REPORT_FILE:-/tmp/devcontainer-sync-local-auth.report}"
POST_START_SUMMARY="${DEVCONTAINER_POST_START_SUMMARY_FILE:-/tmp/devcontainer-post-start.summary}"
POST_CREATE_STATUS="${DEVCONTAINER_POST_CREATE_STATUS_FILE:-/tmp/devcontainer-post-create.status}"
POST_CREATE_SUMMARY="${DEVCONTAINER_POST_CREATE_SUMMARY_FILE:-/tmp/devcontainer-post-create.summary}"
POST_CREATE_REPORT="${DEVCONTAINER_POST_CREATE_REPORT_FILE:-/tmp/devcontainer-post-create.report}"
POST_CREATE_EVENTS="${DEVCONTAINER_POST_CREATE_EVENTS_FILE:-/tmp/devcontainer-post-create.events.tsv}"
LOCAL_DNS_STATUS="${DEVCONTAINER_LOCAL_DNS_STATUS_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_STATUS_FILE:-/tmp/devcontainer-local-dns-cache.status}}"
LOCAL_DNS_SUMMARY="${DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.summary}}"
LOCAL_DNS_ACTION_SUMMARY="${DEVCONTAINER_LOCAL_DNS_ACTION_SUMMARY_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_ACTION_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.action.summary}}"
LOCAL_DNS_EVENTS="${DEVCONTAINER_LOCAL_DNS_EVENTS_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_EVENTS_FILE:-/tmp/devcontainer-local-dns-cache.events.tsv}}"
MANAGER_STATUS="${DEVCONTAINER_COPILOT_NETWORK_STATUS_FILE:-/tmp/devcontainer-copilot-network.status}"
MANAGER_SUMMARY="${DEVCONTAINER_COPILOT_NETWORK_SUMMARY_FILE:-/tmp/devcontainer-copilot-network.summary}"
MANAGER_RECOMMENDATION="${DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_FILE:-/tmp/devcontainer-copilot-network.recommendation}"
MANAGER_RECOMMENDATION_JSON="${DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_JSON_FILE:-/tmp/devcontainer-copilot-network.recommendation.json}"
ROUTE_STATUS="${DEVCONTAINER_GITHUB_ROUTE_STATUS_FILE:-/tmp/devcontainer-github-api-route.status}"
ROUTE_SUMMARY="${DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.summary}"
ROUTE_ACTION_SUMMARY="${DEVCONTAINER_GITHUB_ROUTE_ACTION_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.action.summary}"
PROXY_STATUS="${DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_FILE:-/tmp/devcontainer-copilot-proxy.status}"
PROXY_SUMMARY="${DEVCONTAINER_LOCAL_COPILOT_PROXY_SUMMARY_FILE:-/tmp/devcontainer-copilot-proxy.summary}"
PROXY_COMPARISON="${DEVCONTAINER_LOCAL_COPILOT_PROXY_COMPARISON_FILE:-/tmp/devcontainer-copilot-proxy.comparison.tsv}"
PROXY_RECOMMENDATION="${DEVCONTAINER_LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE:-/tmp/devcontainer-copilot-proxy.recommendation}"
ADVISOR_STATUS="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_STATUS_FILE:-/tmp/devcontainer-copilot-route-advisor.status}"
ADVISOR_SUMMARY="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_SUMMARY_FILE:-/tmp/devcontainer-copilot-route-advisor.summary}"

REGISTRY_CANONICAL="${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE:-${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY:-${PROJECT_ROOT%/}/.devcontainer/scripts/network/endpoints.github-copilot.tsv}}"
REGISTRY_LEGACY="${PROJECT_ROOT%/}/.devcontainer/network/endpoints.github-copilot.tsv"
REGISTRY_FILE="${REGISTRY_CANONICAL}"
if [[ ! -r "${REGISTRY_FILE}" && -r "${REGISTRY_LEGACY}" ]]; then
    REGISTRY_FILE="${REGISTRY_LEGACY}"
fi

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
ts() { date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date; }
now_epoch() { date '+%s' 2> /dev/null || printf '0'; }
has_cmd() { command -v "$1" > /dev/null 2>&1; }
is_uint() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

sanitize_oneline() {
    local value
    if [[ $# -gt 0 ]]; then
        value="$*"
    else
        IFS= read -r value || value=""
    fi
    value="${value//$'
'/ }"
    value="${value//$'
'/ }"
    value="${value//$'	'/ }"
    printf '%s' "${value:0:4096}"
}

ensure_parent_dir() {
    local path dir
    path="${1:-}"
    [[ -n "${path}" ]] || return 1
    dir="$(dirname "${path}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${dir}" 2> /dev/null || true
}

write_atomic_file() {
    local target content mode dir tmp
    target="${1:-}"
    content="${2:-}"
    mode="${3:-0644}"
    [[ "${NO_WRITE}" == "true" ]] && return 0
    [[ -n "${target}" ]] || return 1
    ensure_parent_dir "${target}"
    dir="$(dirname "${target}" 2> /dev/null || printf '/tmp')"
    tmp="$(mktemp "${dir%/}/.${SCRIPT_NAME}.XXXXXX" 2> /dev/null || true)"
    [[ -n "${tmp}" ]] || return 1
    printf '%s\n' "${content}" > "${tmp}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
    chmod "${mode}" "${tmp}" 2> /dev/null || true
    mv -f "${tmp}" "${target}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
}

read_first_line() {
    local file fallback value
    file="${1:-}"
    fallback="${2:-unknown}"
    if [[ -r "${file}" ]]; then
        value="$(awk 'NR==1{print; exit}' "${file}" 2> /dev/null | sanitize_oneline)"
        printf '%s' "${value:-${fallback}}"
        return 0
    fi
    printf '%s' "${fallback}"
}

kv_get() {
    local file key value
    file="${1:-}"
    key="${2:-}"
    [[ -r "${file}" && -n "${key}" ]] || return 1
    value="$(awk -v k="${key}" 'index($0, k "=") == 1 { sub(/^[^=]*=/, "", $0); print; exit }' "${file}" 2> /dev/null | sanitize_oneline)"
    [[ -n "${value}" ]] || return 1
    printf '%s' "${value}"
}

kv_or() {
    local value
    value="$(kv_get "${1:-}" "${2:-}" 2> /dev/null || true)"
    printf '%s' "${value:-${3:-unknown}}"
}

kv_any_or() {
    local file fallback key value
    file="${1:-}"
    fallback="${2:-unknown}"
    shift 2 || true
    for key in "$@"; do
        value="$(kv_get "${file}" "${key}" 2> /dev/null || true)"
        if [[ -n "${value}" ]]; then
            printf '%s' "${value}"
            return 0
        fi
    done
    printf '%s' "${fallback}"
}

file_mtime_epoch() {
    local file
    file="${1:-}"
    [[ -e "${file}" ]] || {
        printf '0'
        return 0
    }
    stat -c '%Y' "${file}" 2> /dev/null || printf '0'
}

file_age_seconds() {
    local file now mtime
    file="${1:-}"
    now="$(now_epoch)"
    mtime="$(file_mtime_epoch "${file}")"
    is_uint "${now}" || now=0
    is_uint "${mtime}" || mtime=0
    if ((mtime <= 0 || now < mtime)); then printf '999999999'; else printf '%s' "$((now - mtime))"; fi
}

artifact_state() {
    local file max_age age
    file="${1:-}"
    max_age="${2:-${MAX_AGE_SECONDS}}"
    is_uint "${max_age}" || max_age=86400
    [[ -e "${file}" ]] || {
        printf 'missing'
        return 0
    }
    [[ -r "${file}" ]] || {
        printf 'unreadable'
        return 0
    }
    age="$(file_age_seconds "${file}")"
    if is_uint "${age}" && ((age <= max_age)); then printf 'fresh'; else printf 'stale'; fi
}

status_from_status_summary() {
    local status_file summary_file key value
    status_file="${1:-}"
    summary_file="${2:-}"
    key="${3:-status}"
    value="$(kv_get "${summary_file}" "${key}" 2> /dev/null || true)"
    if [[ -z "${value}" && -r "${status_file}" ]]; then value="$(read_first_line "${status_file}" unknown)"; fi
    printf '%s' "${value:-unknown}"
}

# -----------------------------------------------------------------------------
# Event model
# -----------------------------------------------------------------------------
EVENTS_TMP="$(mktemp /tmp/network-control-plane-events.XXXXXX 2> /dev/null || true)"
[[ -n "${EVENTS_TMP}" ]] || EVENTS_TMP="/tmp/network-control-plane-events.$$"
: > "${EVENTS_TMP}" 2> /dev/null || true

cleanup_tmp() {
    rm -f "${EVENTS_TMP:-}" "${_JSON_TMP_PREFIX:-}" "${_JSON_TMP_PREFIX:-}.summary" 2> /dev/null || true
}
trap cleanup_tmp EXIT

OK_COUNT=0
INFO_COUNT=0
ADVISORY_COUNT=0
WARNING_COUNT=0
DEGRADED_COUNT=0
FAILED_COUNT=0
FATAL_COUNT=0
OVERALL_LEVEL=0

severity_level() {
    case "${1:-info}" in
        ok) printf '0' ;;
        info) printf '1' ;;
        advisory | warning) printf '2' ;;
        degraded) printf '3' ;;
        failed) printf '4' ;;
        fatal) printf '5' ;;
        *) printf '1' ;;
    esac
}

level_status() {
    case "${1:-0}" in
        0 | 1) printf 'ok' ;;
        2) printf 'advisory' ;;
        3) printf 'degraded' ;;
        4) printf 'failed' ;;
        *) printf 'fatal' ;;
    esac
}

add_event() {
    local severity component code message level
    severity="${1:-info}"
    component="$(sanitize_oneline "${2:-general}")"
    code="$(sanitize_oneline "${3:-event}")"
    message="$(sanitize_oneline "${4:-}")"
    level="$(severity_level "${severity}")"
    if is_uint "${level}" && ((level > OVERALL_LEVEL)); then OVERALL_LEVEL="${level}"; fi
    case "${severity}" in
        ok) OK_COUNT=$((OK_COUNT + 1)) ;;
        info) INFO_COUNT=$((INFO_COUNT + 1)) ;;
        advisory) ADVISORY_COUNT=$((ADVISORY_COUNT + 1)) ;;
        warning) WARNING_COUNT=$((WARNING_COUNT + 1)) ;;
        degraded) DEGRADED_COUNT=$((DEGRADED_COUNT + 1)) ;;
        failed) FAILED_COUNT=$((FAILED_COUNT + 1)) ;;
        fatal) FATAL_COUNT=$((FATAL_COUNT + 1)) ;;
        *) INFO_COUNT=$((INFO_COUNT + 1)) ;;
    esac
    printf '%s\t%s\t%s\t%s\t%s\n' "$(ts)" "${severity}" "${component}" "${code}" "${message}" >> "${EVENTS_TMP}" 2> /dev/null || true
}

# -----------------------------------------------------------------------------
# Passive inspectors
# -----------------------------------------------------------------------------
CURRENT_RESOLV_NAMESERVERS="unknown"
CURRENT_RESOLV_FIRST_NS="unknown"
CURRENT_RESOLV_MTIME="0"
CURRENT_RESOLV_INODE="unknown"
CURRENT_RESOLV_HASH="unknown"
CURRENT_HOSTS_API_IP="unknown"

read_current_resolv_state() {
    local nameservers
    if [[ -r /etc/resolv.conf ]]; then
        nameservers="$(awk '$1 == "nameserver" { printf "%s%s", sep, $2; sep=" " }' /etc/resolv.conf 2> /dev/null | sanitize_oneline)"
        CURRENT_RESOLV_NAMESERVERS="${nameservers:-none}"
        CURRENT_RESOLV_FIRST_NS="$(awk '$1 == "nameserver" {print $2; exit}' /etc/resolv.conf 2> /dev/null | sanitize_oneline)"
        [[ -n "${CURRENT_RESOLV_FIRST_NS}" ]] || CURRENT_RESOLV_FIRST_NS="none"
        CURRENT_RESOLV_MTIME="$(stat -c '%Y' /etc/resolv.conf 2> /dev/null || printf '0')"
        CURRENT_RESOLV_INODE="$(stat -c '%i' /etc/resolv.conf 2> /dev/null || printf 'unknown')"
        if has_cmd sha256sum; then
            CURRENT_RESOLV_HASH="$(sha256sum /etc/resolv.conf 2> /dev/null | awk '{print $1}' | sanitize_oneline)"
        elif has_cmd cksum; then
            CURRENT_RESOLV_HASH="cksum:$(cksum /etc/resolv.conf 2> /dev/null | awk '{print $1":"$2}' | sanitize_oneline)"
        fi
        add_event ok dns resolv-readable "current_nameservers=${CURRENT_RESOLV_NAMESERVERS}; first=${CURRENT_RESOLV_FIRST_NS}"
    else
        CURRENT_RESOLV_NAMESERVERS="unreadable"
        CURRENT_RESOLV_FIRST_NS="unreadable"
        add_event degraded dns resolv-unreadable "/etc/resolv.conf is not readable"
    fi
}

read_hosts_state() {
    if [[ -r /etc/hosts ]]; then
        CURRENT_HOSTS_API_IP="$(awk '$0 !~ /^#/ { for (i=2; i<=NF; i++) if ($i == "api.github.com") { print $1; exit } }' /etc/hosts 2> /dev/null | sanitize_oneline)"
        [[ -n "${CURRENT_HOSTS_API_IP}" ]] || CURRENT_HOSTS_API_IP="none"
        add_event ok route hosts-readable "api.github.com_hosts_ip=${CURRENT_HOSTS_API_IP}"
    else
        CURRENT_HOSTS_API_IP="unreadable"
        add_event advisory route hosts-unreadable "/etc/hosts is not readable"
    fi
}

REGISTRY_STATUS="unknown"
REGISTRY_ROWS="0"
REGISTRY_BAD_ROWS="0"
REGISTRY_BAD_EXAMPLES="none"

inspect_registry() {
    local output
    if [[ ! -r "${REGISTRY_FILE}" ]]; then
        REGISTRY_STATUS="missing"
        add_event degraded registry missing "endpoint registry not readable: ${REGISTRY_FILE}"
        return 0
    fi
    output="$(awk -F '\t' '
        /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
        {
            rows++
            bad_reason=""
            if (NF != 5) bad_reason="field-count"
            else if ($1 !~ /^https:\/\//) bad_reason="non-https-url"
            else if ($2 == "" || $3 == "" || $4 == "" || $5 == "") bad_reason="empty-field"
            if (bad_reason != "") {
                bad++
                if (examples == "") examples=NR ":" bad_reason ":" $1
                else if (split(examples, a, /,/) < 5) examples=examples "," NR ":" bad_reason ":" $1
            }
        }
        END { print rows+0 "\t" bad+0 "\t" (examples == "" ? "none" : examples) }
    ' "${REGISTRY_FILE}" 2> /dev/null)"
    REGISTRY_ROWS="$(printf '%s' "${output}" | awk -F '\t' '{print $1}')"
    REGISTRY_BAD_ROWS="$(printf '%s' "${output}" | awk -F '\t' '{print $2}')"
    REGISTRY_BAD_EXAMPLES="$(printf '%s' "${output}" | awk -F '\t' '{print $3}')"
    is_uint "${REGISTRY_ROWS}" || REGISTRY_ROWS=0
    is_uint "${REGISTRY_BAD_ROWS}" || REGISTRY_BAD_ROWS=0
    if ((REGISTRY_ROWS <= 0)); then
        REGISTRY_STATUS="empty"
        add_event degraded registry empty "registry has no active rows: ${REGISTRY_FILE}"
    elif ((REGISTRY_BAD_ROWS > 0)); then
        REGISTRY_STATUS="degraded"
        add_event degraded registry bad-rows "rows=${REGISTRY_ROWS}; bad=${REGISTRY_BAD_ROWS}; examples=${REGISTRY_BAD_EXAMPLES}"
    else
        REGISTRY_STATUS="ok"
        add_event ok registry ok "rows=${REGISTRY_ROWS}; file=${REGISTRY_FILE}"
    fi
}

inspect_artifact_presence() {
    local component file required state age
    component="${1:-artifact}"
    file="${2:-}"
    required="${3:-false}"
    state="$(artifact_state "${file}" "${MAX_AGE_SECONDS}")"
    age="$(file_age_seconds "${file}")"
    case "${state}:${required}" in
        fresh:*) add_event ok "${component}" artifact-fresh "${file}; age=${age}s" ;;
        stale:*) add_event warning "${component}" artifact-stale "${file}; age=${age}s" ;;
        missing:true) add_event degraded "${component}" artifact-missing "${file}" ;;
        missing:false) add_event advisory "${component}" artifact-missing "${file}" ;;
        unreadable:*) add_event degraded "${component}" artifact-unreadable "${file}" ;;
        *) add_event info "${component}" artifact-state "${file}; state=${state}; age=${age}s" ;;
    esac
}

HEALTH_STATE="unknown"
POST_CREATE_STATE="unknown"
SYNC_LOCAL_AUTH_STATE="unknown"
POST_START_STATE="unknown"
DNS_STATE="unknown"
DNS_DRIFT="unknown"
MANAGER_STATE="unknown"
ROUTE_STATE="unknown"
ROUTE_RUNTIME_KIND="unknown"
ROUTE_AUTHORITY_STATE="unknown"
ROUTE_ACTION_STATE="unknown"
PROXY_STATE="unknown"
ADVISOR_STATE="unknown"
NEXT_ACTIONS=""

add_next_action() {
    local action
    action="$(sanitize_oneline "${1:-}")"
    [[ -n "${action}" ]] || return 0
    case ",${NEXT_ACTIONS}," in *",${action},"*) return 0 ;; esac
    if [[ -z "${NEXT_ACTIONS}" ]]; then NEXT_ACTIONS="${action}"; else NEXT_ACTIONS="${NEXT_ACTIONS},${action}"; fi
}

inspect_core() {
    if [[ -r "${STATE_MANIFEST}" ]]; then
        add_event ok core manifest-present "${STATE_MANIFEST}; status=$(kv_or "${STATE_MANIFEST}" status unknown); integrity=$(kv_or "${STATE_MANIFEST}" integrity unknown)"
    else
        add_event degraded core manifest-missing "structural manifest missing: ${STATE_MANIFEST}"
        add_next_action "rebuild-container"
    fi

    POST_CREATE_STATE="$(status_from_status_summary "${POST_CREATE_STATUS}" "${POST_CREATE_SUMMARY}" status)"
    if [[ -r "${POST_CREATE_SUMMARY}" || -r "${POST_CREATE_STATUS}" ]]; then
        case "${POST_CREATE_STATE}" in
            ready | ready-ok | ok) add_event ok post-create ok "post-create status=${POST_CREATE_STATE}; version=$(kv_or "${POST_CREATE_SUMMARY}" script_version unknown)" ;;
            ready-degraded | degraded)
                add_event advisory post-create degraded "post-create structural status=${POST_CREATE_STATE}; warnings=$(kv_or "${POST_CREATE_SUMMARY}" script_audit_warnings 0)"
                add_next_action "npm run health:brief"
                ;;
            failed | fatal)
                add_event degraded post-create "post-create-${POST_CREATE_STATE}" "post-create status=${POST_CREATE_STATE}"
                add_next_action "rebuild-container"
                ;;
            *) add_event info post-create status "post-create status=${POST_CREATE_STATE}" ;;
        esac
    else
        add_event advisory post-create missing "post-create artifact missing; normal only before postCreateCommand has run"
    fi

    SYNC_LOCAL_AUTH_STATE="$(status_from_status_summary "${SYNC_LOCAL_AUTH_STATUS}" "${SYNC_LOCAL_AUTH_SUMMARY}" status)"
    if [[ -r "${SYNC_LOCAL_AUTH_SUMMARY}" || -r "${SYNC_LOCAL_AUTH_STATUS}" ]]; then
        case "${SYNC_LOCAL_AUTH_STATE}" in
            ok | ready | skipped | off) add_event ok sync-local-auth ok "status=${SYNC_LOCAL_AUTH_STATE}" ;;
            degraded | failed) add_event advisory sync-local-auth "sync-${SYNC_LOCAL_AUTH_STATE}" "status=${SYNC_LOCAL_AUTH_STATE}" ;;
            *) add_event info sync-local-auth status "status=${SYNC_LOCAL_AUTH_STATE}" ;;
        esac
    else
        add_event advisory sync-local-auth missing "sync-local-auth artifact missing"
    fi

    HEALTH_STATE="$(status_from_status_summary "${HEALTH_STATUS}" "${HEALTH_SUMMARY}" status)"
    case "${HEALTH_STATE}" in
        ok) add_event ok health ok "healthcheck status=ok" ;;
        degraded | failed | fatal | unhealthy)
            add_event degraded health "health-${HEALTH_STATE}" "healthcheck status=${HEALTH_STATE}"
            add_next_action "make health-brief"
            ;;
        unknown)
            add_event advisory health unknown "healthcheck artifact missing or unknown"
            add_next_action "make health-brief"
            ;;
        *) add_event info health status "healthcheck status=${HEALTH_STATE}" ;;
    esac

    POST_START_STATE="$(kv_or "${POST_START_SUMMARY}" status unknown)"
    if [[ -r "${POST_START_SUMMARY}" ]]; then
        case "${POST_START_STATE}" in
            ok) add_event ok post-start ok "post-start summary ok; version=$(kv_or "${POST_START_SUMMARY}" script_version unknown)" ;;
            degraded | failed | stale)
                add_event degraded post-start "post-start-${POST_START_STATE}" "status=${POST_START_STATE}; reason=$(kv_or "${POST_START_SUMMARY}" reason unknown)"
                add_next_action "npm run network:summary"
                ;;
            *) add_event advisory post-start status "status=${POST_START_STATE}" ;;
        esac
    else
        add_event advisory post-start missing "post-start summary missing"
        add_next_action "npm run network:summary"
    fi
}

inspect_dns() {
    local enabled summary_points summary_bind summary_first summary_hash summary_drift summary_drift_reason resolver_effective runtime_effective owner_visibility local_probe_proven docker_split warmup_status
    enabled="${DEVCONTAINER_ENABLE_LOCAL_DNS_CACHE:-$(kv_or "${POST_START_SUMMARY}" local_dns_enabled false)}"
    DNS_STATE="$(status_from_status_summary "${LOCAL_DNS_STATUS}" "${LOCAL_DNS_SUMMARY}" status)"
    summary_points="$(kv_or "${LOCAL_DNS_SUMMARY}" resolv_conf_points_to_cache unknown)"
    summary_bind="$(kv_or "${LOCAL_DNS_SUMMARY}" bind_address 127.0.0.1)"
    summary_first="$(kv_or "${LOCAL_DNS_SUMMARY}" resolv_conf_first_nameserver "$(kv_or "${LOCAL_DNS_SUMMARY}" resolv_conf_nameservers unknown)")"
    summary_hash="$(kv_or "${LOCAL_DNS_SUMMARY}" resolv_conf_sha256 unknown)"
    summary_drift="$(kv_or "${LOCAL_DNS_SUMMARY}" resolv_conf_drift false)"
    summary_drift_reason="$(kv_or "${LOCAL_DNS_SUMMARY}" resolv_conf_drift_reason none)"
    resolver_effective="$(kv_or "${LOCAL_DNS_SUMMARY}" resolver_effective unknown)"
    runtime_effective="$(kv_or "${LOCAL_DNS_SUMMARY}" runtime_effective unknown)"
    owner_visibility="$(kv_or "${LOCAL_DNS_SUMMARY}" dnsmasq_socket_owner_visibility unknown)"
    local_probe_proven="$(kv_or "${LOCAL_DNS_SUMMARY}" local_probe_proven unknown)"
    docker_split="$(kv_or "${LOCAL_DNS_SUMMARY}" docker_embedded_split_status unknown)"
    warmup_status="$(kv_or "${LOCAL_DNS_SUMMARY}" warmup_status unknown)"
    DNS_DRIFT="false"

    if [[ ! -r "${LOCAL_DNS_SUMMARY}" ]]; then
        if [[ "${enabled}" == "true" ]]; then
            add_event degraded dns summary-missing "DNS cache enabled but summary missing"
            add_next_action "npm run network:dns:doctor"
        else
            add_event advisory dns summary-missing "DNS cache summary missing; cache may be disabled"
        fi
        return 0
    fi

    case "${DNS_STATE}" in
        ok) add_event ok dns summary-ok "runtime=${runtime_effective}; resolver=${resolver_effective}; points=${summary_points}; first=${summary_first}; local_probe=${local_probe_proven}; docker_split=${docker_split}; warmup=${warmup_status}" ;;
        off | disabled | skipped) add_event info dns off "DNS cache status=${DNS_STATE}" ;;
        stale | degraded | failed)
            add_event degraded dns "dns-${DNS_STATE}" "status=${DNS_STATE}; reason=$(kv_or "${LOCAL_DNS_SUMMARY}" reason unknown)"
            add_next_action "npm run network:dns:doctor"
            ;;
        *) add_event advisory dns status "DNS cache status=${DNS_STATE}" ;;
    esac

    if [[ "${summary_drift}" == "true" ]]; then
        DNS_DRIFT="true"
        add_event degraded dns resolv-drift-reported "${summary_drift_reason}"
        add_next_action "npm run network:dns:doctor"
    fi

    if [[ "${summary_points}" == "true" ]]; then
        if [[ "${CURRENT_RESOLV_FIRST_NS}" != "${summary_bind}" ]]; then
            DNS_DRIFT="true"
            add_event degraded dns resolv-drift-current "summary_points_to_cache=true; bind=${summary_bind}; current_first_ns=${CURRENT_RESOLV_FIRST_NS}"
            add_next_action "npm run network:dns:doctor"
        fi
        if [[ "${summary_hash}" != "unknown" && "${CURRENT_RESOLV_HASH}" != "unknown" && "${summary_hash}" != "${CURRENT_RESOLV_HASH}" ]]; then
            DNS_DRIFT="true"
            add_event degraded dns resolv-hash-drift "summary_hash=${summary_hash}; current_hash=${CURRENT_RESOLV_HASH}"
            add_next_action "npm run network:dns:doctor"
        fi
    fi

    if [[ "${owner_visibility}" == "hidden-or-unavailable" || "${owner_visibility}" == "users-without-pid" ]]; then
        add_event advisory dns socket-owner-visibility "socket owner visibility=${owner_visibility}"
    fi
    if [[ "${summary_points}" == "true" && "${local_probe_proven}" != "true" ]]; then
        add_event degraded dns local-probe-not-proven "resolv.conf points to cache but local_probe_proven=${local_probe_proven}"
        add_next_action "npm run network:dns:doctor"
    fi
    if [[ "${docker_split}" == "disabled" && "${CURRENT_RESOLV_NAMESERVERS}" == *"127.0.0.11"* ]]; then
        add_event advisory dns docker-embedded-observed-without-split "current resolv.conf includes Docker embedded DNS but split status is disabled"
    fi
}

inspect_manager() {
    local registry_status registry_bad_hosts registry_bad_urls endpoints_total endpoints_ok worst_host blockers next_diag recommendations
    MANAGER_STATE="$(status_from_status_summary "${MANAGER_STATUS}" "${MANAGER_SUMMARY}" status)"
    if [[ ! -r "${MANAGER_SUMMARY}" ]]; then
        add_event degraded manager summary-missing "Copilot network manager summary missing"
        add_next_action "npm run network:manager:doctor"
        return 0
    fi

    registry_status="$(kv_or "${MANAGER_SUMMARY}" endpoint_registry_status unknown)"
    registry_bad_hosts="$(kv_or "${MANAGER_SUMMARY}" endpoint_registry_bad_hosts 0)"
    registry_bad_urls="$(kv_or "${MANAGER_SUMMARY}" endpoint_registry_bad_urls 0)"
    endpoints_total="$(kv_or "${MANAGER_SUMMARY}" endpoints_total 0)"
    endpoints_ok="$(kv_or "${MANAGER_SUMMARY}" endpoints_ok 0)"
    worst_host="$(kv_or "${MANAGER_SUMMARY}" current_worst_host unknown)"
    blockers="$(kv_or "${MANAGER_SUMMARY}" manager_recommendation_blockers none)"
    next_diag="$(kv_any_or "${MANAGER_SUMMARY}" none next_diagnostic_actions manager_next_diagnostic_actions)"
    recommendations="$(kv_or "${MANAGER_SUMMARY}" recommendations observe)"

    case "${MANAGER_STATE}" in
        ok) add_event ok manager ok "endpoints=${endpoints_ok}/${endpoints_total}; recommendation=$(kv_or "${MANAGER_SUMMARY}" manager_recommendation_action unknown)" ;;
        degraded | failed)
            add_event degraded manager "manager-${MANAGER_STATE}" "status=${MANAGER_STATE}; blockers=${blockers}"
            add_next_action "npm run network:manager:doctor"
            ;;
        *) add_event advisory manager status "status=${MANAGER_STATE}; endpoints=${endpoints_ok}/${endpoints_total}" ;;
    esac

    if [[ "${registry_status}" == "invalid" || "${registry_status}" == "degraded" ]]; then
        add_event degraded manager registry-invalid "manager registry=${registry_status}; bad_hosts=${registry_bad_hosts}; bad_urls=${registry_bad_urls}; examples=$(kv_any_or "${MANAGER_SUMMARY}" none endpoint_registry_bad_host_examples endpoint_registry_bad_url_examples)"
        add_next_action "npm run network:manager:doctor"
    fi

    if [[ "${REGISTRY_STATUS}" == "ok" && "${registry_status}" == "invalid" ]]; then
        add_event degraded registry registry-consumer-disagreement "local TSV audit ok, manager says invalid"
        add_next_action "npm run network:manager:doctor"
    fi

    if [[ "${endpoints_total}" == "0" && "${worst_host}" != "unknown" && "${worst_host}" != "none" ]]; then
        add_event degraded manager inconsistent-summary "endpoints_total=0 but current_worst_host=${worst_host}"
        add_next_action "npm run network:manager:doctor"
    fi

    if [[ "${next_diag}" != "none" && "${next_diag}" != "unknown" ]]; then
        add_event advisory manager next-diagnostics "${next_diag}"
        add_next_action "${next_diag}"
    elif [[ "${recommendations}" != "observe" && "${recommendations}" != "none" && "${recommendations}" != "unknown" ]]; then
        add_event advisory manager recommendations "${recommendations}"
        add_next_action "${recommendations}"
    fi
}

inspect_route() {
    local action action_status selected_ip current_ip verify_status apply_status runtime_route_status route_summary_state route_summary_age original_route_state
    ROUTE_STATE="$(status_from_status_summary "${ROUTE_STATUS}" "${ROUTE_SUMMARY}" status)"
    ROUTE_RUNTIME_KIND="$(kv_or "${ROUTE_SUMMARY}" summary_kind legacy-runtime-summary)"
    ROUTE_AUTHORITY_STATE="unknown"
    ROUTE_ACTION_STATE="$(kv_or "${ROUTE_ACTION_SUMMARY}" status unknown)"
    action="$(kv_or "${ROUTE_ACTION_SUMMARY}" action unknown)"
    action_status="$(kv_or "${ROUTE_ACTION_SUMMARY}" action_status unknown)"
    selected_ip="$(kv_or "${ROUTE_SUMMARY}" selected_ip none)"
    current_ip="$(kv_or "${ROUTE_SUMMARY}" current_ip unknown)"
    verify_status="$(kv_or "${ROUTE_SUMMARY}" verify_status unknown)"
    apply_status="$(kv_or "${ROUTE_SUMMARY}" hosts_apply_status unknown)"
    runtime_route_status="$(kv_or "${ROUTE_SUMMARY}" runtime_route_status "${ROUTE_STATE}")"

    if [[ ! -r "${ROUTE_SUMMARY}" ]]; then
        ROUTE_AUTHORITY_STATE="missing"
        if [[ -r "${ROUTE_ACTION_SUMMARY}" ]]; then
            add_event advisory route runtime-summary-missing "runtime route summary missing; action summary present action=${action}; status=${ROUTE_ACTION_STATE}/${action_status}"
        else
            add_event advisory route summary-missing "GitHub API route runtime summary missing"
        fi
        add_next_action "npm run network:route:doctor"
        return 0
    fi

    route_summary_state="$(artifact_state "${ROUTE_SUMMARY}" "${MAX_AGE_SECONDS}")"
    route_summary_age="$(file_age_seconds "${ROUTE_SUMMARY}")"
    if [[ "${route_summary_state}" == "stale" ]]; then
        original_route_state="${ROUTE_STATE}"
        ROUTE_AUTHORITY_STATE="stale-nonauthoritative"
        ROUTE_STATE="stale"
        add_event advisory route stale-summary-not-authoritative "age=${route_summary_age}s; summary_kind=${ROUTE_RUNTIME_KIND}; historical_status=${original_route_state}; current hosts fact=${CURRENT_HOSTS_API_IP}"
        add_next_action "npm run network:route:doctor"
        if [[ -r "${ROUTE_ACTION_SUMMARY}" ]]; then
            add_event info route action-summary "action=${action}; status=${ROUTE_ACTION_STATE}; action_status=${action_status}; age=$(file_age_seconds "${ROUTE_ACTION_SUMMARY}")s"
        fi
        return 0
    fi

    if [[ "${ROUTE_RUNTIME_KIND}" == "runtime-route" ]]; then
        ROUTE_AUTHORITY_STATE="fresh-runtime"
    else
        ROUTE_AUTHORITY_STATE="fresh-nonruntime"
    fi

    if [[ "${ROUTE_RUNTIME_KIND}" != "runtime-route" && "${ROUTE_STATE}" == benchmark* ]]; then
        add_event degraded route benchmark-as-runtime "route summary appears to be benchmark/action artifact; status=${ROUTE_STATE}"
        add_next_action "npm run network:route:doctor"
    elif [[ "${ROUTE_RUNTIME_KIND}" != "runtime-route" ]]; then
        add_event warning route legacy-summary-kind "summary_kind=${ROUTE_RUNTIME_KIND}; status=${ROUTE_STATE}"
    fi

    case "${ROUTE_STATE}" in
        ok) add_event ok route runtime-ok "runtime=${runtime_route_status}; selected=${selected_ip}; current=${current_ip}; apply=${apply_status}; verify=${verify_status}" ;;
        failed | degraded)
            add_event degraded route "route-${ROUTE_STATE}" "selected=${selected_ip}; current=${current_ip}; verify=${verify_status}"
            add_next_action "npm run network:route:doctor"
            ;;
        benchmark-ok | benchmarking | benchmark-degraded) add_event advisory route action-status-in-runtime "status=${ROUTE_STATE}; should live in action.summary" ;;
        unknown) add_event advisory route unknown "route runtime status unknown" ;;
        *) add_event info route status "status=${ROUTE_STATE}; selected=${selected_ip}; current=${current_ip}" ;;
    esac

    if [[ -r "${ROUTE_ACTION_SUMMARY}" ]]; then
        add_event info route action-summary "action=${action}; status=${ROUTE_ACTION_STATE}; action_status=${action_status}; age=$(file_age_seconds "${ROUTE_ACTION_SUMMARY}")s"
    fi

    if [[ "${CURRENT_HOSTS_API_IP}" != "none" && "${selected_ip}" != "none" && "${selected_ip}" != "unknown" && "${CURRENT_HOSTS_API_IP}" != "${selected_ip}" ]]; then
        add_event advisory route hosts-selected-mismatch "hosts_api_ip=${CURRENT_HOSTS_API_IP}; selected_ip=${selected_ip}"
    fi
}

inspect_proxy() {
    local enabled confidence mode rec_action
    enabled="${DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY:-false}"
    PROXY_STATE="$(status_from_status_summary "${PROXY_STATUS}" "${PROXY_SUMMARY}" status)"
    mode="$(kv_or "${PROXY_SUMMARY}" mode unknown)"
    rec_action="$(kv_any_or "${PROXY_SUMMARY}" unknown recommendation_action recommended_action action)"
    confidence="$(kv_any_or "${PROXY_SUMMARY}" unknown recommendation_confidence confidence)"

    if [[ ! -r "${PROXY_SUMMARY}" ]]; then
        if [[ "${enabled}" == "true" ]]; then
            add_event advisory proxy summary-missing "proxy enabled but summary missing"
            add_next_action "npm run network:proxy:doctor"
        else
            add_event ok proxy off-unobserved "local Copilot proxy not enabled; no summary required"
        fi
        return 0
    fi

    case "${PROXY_STATE}" in
        ok | running) add_event ok proxy running "mode=${mode}; rec=${rec_action}; confidence=${confidence}" ;;
        off | disabled | skipped) add_event ok proxy off "mode=${mode}; rec=${rec_action}; confidence=${confidence}" ;;
        degraded | failed) add_event advisory proxy "proxy-${PROXY_STATE}" "mode=${mode}; rec=${rec_action}; confidence=${confidence}" ;;
        *) add_event info proxy status "status=${PROXY_STATE}; mode=${mode}; rec=${rec_action}" ;;
    esac

    if [[ "${rec_action}" == "prefer-proxy-opt-in" ]]; then
        add_event advisory proxy proxy-opt-in-recommended "confidence=${confidence}; manual opt-in only"
        add_next_action "npm run network:proxy:env"
    fi
}

inspect_advisor() {
    local recommendations better failed
    ADVISOR_STATE="$(status_from_status_summary "${ADVISOR_STATUS}" "${ADVISOR_SUMMARY}" status)"
    if [[ ! -r "${ADVISOR_SUMMARY}" ]]; then
        add_event advisory advisor missing "route advisor snapshot missing; normal before manual execution"
        return 0
    fi
    better="$(kv_or "${ADVISOR_SUMMARY}" endpoints_with_better_candidate 0)"
    failed="$(kv_or "${ADVISOR_SUMMARY}" endpoints_current_failed 0)"
    recommendations="$(kv_or "${ADVISOR_SUMMARY}" recommendations observe)"
    case "${ADVISOR_STATE}" in
        ok) add_event ok advisor ok "better=${better}; current_failed=${failed}; rec=${recommendations}" ;;
        degraded | failed) add_event advisory advisor "advisor-${ADVISOR_STATE}" "better=${better}; current_failed=${failed}; rec=${recommendations}" ;;
        *) add_event info advisor status "status=${ADVISOR_STATE}; better=${better}; current_failed=${failed}" ;;
    esac
    if [[ "${better}" =~ ^[0-9]+$ && "${better}" -gt 0 ]]; then
        add_event advisory advisor better-candidates "endpoints_with_better_candidate=${better}"
        add_next_action "npm run network:advisor:summary"
    fi
}

inspect_artifacts() {
    inspect_artifact_presence post-create "${POST_CREATE_SUMMARY}" false
    inspect_artifact_presence post-create-report "${POST_CREATE_REPORT}" false
    inspect_artifact_presence post-create-events "${POST_CREATE_EVENTS}" false
    inspect_artifact_presence health "${HEALTH_SUMMARY}" false
    inspect_artifact_presence health-report "${HEALTH_REPORT}" false
    inspect_artifact_presence health-events "${HEALTH_EVENTS}" false
    inspect_artifact_presence sync-local-auth "${SYNC_LOCAL_AUTH_SUMMARY}" false
    inspect_artifact_presence sync-local-auth-report "${SYNC_LOCAL_AUTH_REPORT}" false
    inspect_artifact_presence post-start "${POST_START_SUMMARY}" false
    inspect_artifact_presence dns "${LOCAL_DNS_SUMMARY}" false
    inspect_artifact_presence dns-action "${LOCAL_DNS_ACTION_SUMMARY}" false
    inspect_artifact_presence dns-events "${LOCAL_DNS_EVENTS}" false
    inspect_artifact_presence manager "${MANAGER_SUMMARY}" true
    inspect_artifact_presence manager-recommendation "${MANAGER_RECOMMENDATION}" false
    inspect_artifact_presence manager-recommendation-json "${MANAGER_RECOMMENDATION_JSON}" false
    inspect_artifact_presence route "${ROUTE_SUMMARY}" false
    inspect_artifact_presence route-action "${ROUTE_ACTION_SUMMARY}" false
    inspect_artifact_presence proxy "${PROXY_SUMMARY}" false
    inspect_artifact_presence proxy-comparison "${PROXY_COMPARISON}" false
    inspect_artifact_presence proxy-recommendation "${PROXY_RECOMMENDATION}" false
    inspect_artifact_presence advisor "${ADVISOR_SUMMARY}" false
}

# -----------------------------------------------------------------------------
# Output builders
# -----------------------------------------------------------------------------
build_summary_content() {
    local overall
    overall="$(level_status "${OVERALL_LEVEL}")"
    cat << SUMMARY
status=${overall}
script=${SCRIPT_NAME}
script_version=${SCRIPT_VERSION}
completed_at=$(ts)
project_root=${PROJECT_ROOT}
state_manifest=${STATE_MANIFEST}
health_status=${HEALTH_STATE}
post_create_status=${POST_CREATE_STATE}
sync_local_auth_status=${SYNC_LOCAL_AUTH_STATE}
post_start_status=${POST_START_STATE}
registry_status=${REGISTRY_STATUS}
registry_file=${REGISTRY_FILE}
registry_rows=${REGISTRY_ROWS}
registry_bad_rows=${REGISTRY_BAD_ROWS}
registry_bad_examples=${REGISTRY_BAD_EXAMPLES}
current_resolv_nameservers=${CURRENT_RESOLV_NAMESERVERS}
current_resolv_first_nameserver=${CURRENT_RESOLV_FIRST_NS}
current_resolv_mtime_epoch=${CURRENT_RESOLV_MTIME}
current_resolv_inode=${CURRENT_RESOLV_INODE}
current_resolv_sha256=${CURRENT_RESOLV_HASH}
current_hosts_api_github_com_ip=${CURRENT_HOSTS_API_IP}
dns_status=${DNS_STATE}
dns_resolv_conf_drift=${DNS_DRIFT}
dns_local_probe_proven=$(kv_or "${LOCAL_DNS_SUMMARY}" local_probe_proven unknown)
dns_docker_embedded_split_status=$(kv_or "${LOCAL_DNS_SUMMARY}" docker_embedded_split_status unknown)
dns_warmup_status=$(kv_or "${LOCAL_DNS_SUMMARY}" warmup_status unknown)
manager_status=${MANAGER_STATE}
manager_endpoint_registry_status=$(kv_or "${MANAGER_SUMMARY}" endpoint_registry_status unknown)
manager_endpoints_ok=$(kv_or "${MANAGER_SUMMARY}" endpoints_ok 0)
manager_endpoints_total=$(kv_or "${MANAGER_SUMMARY}" endpoints_total 0)
manager_recommendation_action=$(kv_any_or "${MANAGER_SUMMARY}" unknown manager_recommendation_action recommended_action action)
manager_recommended_transport=$(kv_any_or "${MANAGER_SUMMARY}" unknown manager_recommended_transport recommended_transport transport)
manager_next_diagnostic_actions=$(kv_any_or "${MANAGER_SUMMARY}" none next_diagnostic_actions manager_next_diagnostic_actions)
route_status=${ROUTE_STATE}
route_summary_kind=${ROUTE_RUNTIME_KIND}
route_authority_state=${ROUTE_AUTHORITY_STATE}
route_action_status=${ROUTE_ACTION_STATE}
route_selected_ip=$(kv_or "${ROUTE_SUMMARY}" selected_ip none)
route_current_ip=$(kv_or "${ROUTE_SUMMARY}" current_ip unknown)
route_verify_status=$(kv_or "${ROUTE_SUMMARY}" verify_status unknown)
proxy_status=${PROXY_STATE}
proxy_recommendation_action=$(kv_any_or "${PROXY_SUMMARY}" unknown recommendation_action recommended_action action)
advisor_status=${ADVISOR_STATE}
advisor_recommendations=$(kv_or "${ADVISOR_SUMMARY}" recommendations observe)
events_ok=${OK_COUNT}
events_info=${INFO_COUNT}
events_advisory=${ADVISORY_COUNT}
events_warning=${WARNING_COUNT}
events_degraded=${DEGRADED_COUNT}
events_failed=${FAILED_COUNT}
events_fatal=${FATAL_COUNT}
next_actions=${NEXT_ACTIONS:-none}
report=${REPORT_OUT}
events=${EVENTS_OUT}
json=${JSON_OUT}
SUMMARY
}

build_report_content() {
    local overall
    overall="$(level_status "${OVERALL_LEVEL}")"
    {
        printf 'Network/Copilot Control Plane State\n'
        printf '===================================\n\n'
        printf 'script=%s\nversion=%s\ncompleted_at=%s\nstatus=%s\n\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)" "${overall}"
        printf 'Core\n----\n'
        printf 'health=%s\npost_create=%s\nsync_local_auth=%s\npost_start=%s\nmanifest=%s\n\n' "${HEALTH_STATE}" "${POST_CREATE_STATE}" "${SYNC_LOCAL_AUTH_STATE}" "${POST_START_STATE}" "${STATE_MANIFEST}"
        printf 'Registry\n--------\n'
        printf 'status=%s\nfile=%s\nrows=%s\nbad_rows=%s\nbad_examples=%s\n\n' "${REGISTRY_STATUS}" "${REGISTRY_FILE}" "${REGISTRY_ROWS}" "${REGISTRY_BAD_ROWS}" "${REGISTRY_BAD_EXAMPLES}"
        printf 'DNS\n---\n'
        printf 'dns_status=%s\ndrift=%s\ncurrent_nameservers=%s\ncurrent_first_ns=%s\nsummary_points=%s\nsummary_bind=%s\nlocal_probe_proven=%s\ndocker_split=%s\nwarmup=%s\n\n' \
            "${DNS_STATE}" "${DNS_DRIFT}" "${CURRENT_RESOLV_NAMESERVERS}" "${CURRENT_RESOLV_FIRST_NS}" \
            "$(kv_or "${LOCAL_DNS_SUMMARY}" resolv_conf_points_to_cache unknown)" "$(kv_or "${LOCAL_DNS_SUMMARY}" bind_address unknown)" \
            "$(kv_or "${LOCAL_DNS_SUMMARY}" local_probe_proven unknown)" "$(kv_or "${LOCAL_DNS_SUMMARY}" docker_embedded_split_status unknown)" "$(kv_or "${LOCAL_DNS_SUMMARY}" warmup_status unknown)"
        printf 'GitHub API Route\n----------------\n'
        printf 'route_status=%s\nsummary_kind=%s\nauthority=%s\naction_status=%s\nselected_ip=%s\ncurrent_ip=%s\nverify=%s\nhosts_api_ip=%s\n\n' \
            "${ROUTE_STATE}" "${ROUTE_RUNTIME_KIND}" "${ROUTE_AUTHORITY_STATE}" "${ROUTE_ACTION_STATE}" "$(kv_or "${ROUTE_SUMMARY}" selected_ip none)" "$(kv_or "${ROUTE_SUMMARY}" current_ip unknown)" "$(kv_or "${ROUTE_SUMMARY}" verify_status unknown)" "${CURRENT_HOSTS_API_IP}"
        printf 'Copilot Manager\n---------------\n'
        printf 'manager_status=%s\nplanes=%s/%s/%s\nendpoints=%s/%s\nregistry=%s\nrecommendation=%s/%s\nnext_diagnostic_actions=%s\n\n' \
            "${MANAGER_STATE}" "$(kv_or "${MANAGER_SUMMARY}" plane_overall_status unknown)" "$(kv_or "${MANAGER_SUMMARY}" plane_github_api_status unknown)" "$(kv_or "${MANAGER_SUMMARY}" plane_copilot_transport_status unknown)" \
            "$(kv_or "${MANAGER_SUMMARY}" endpoints_ok 0)" "$(kv_or "${MANAGER_SUMMARY}" endpoints_total 0)" "$(kv_or "${MANAGER_SUMMARY}" endpoint_registry_status unknown)" \
            "$(kv_any_or "${MANAGER_SUMMARY}" unknown manager_recommendation_action recommended_action action)" "$(kv_any_or "${MANAGER_SUMMARY}" unknown manager_recommended_transport recommended_transport transport)" "$(kv_any_or "${MANAGER_SUMMARY}" none next_diagnostic_actions manager_next_diagnostic_actions)"
        printf 'Proxy / Advisor\n---------------\n'
        printf 'proxy_status=%s\nproxy_recommendation=%s\nadvisor_status=%s\nadvisor_recommendations=%s\n\n' \
            "${PROXY_STATE}" "$(kv_any_or "${PROXY_SUMMARY}" unknown recommendation_action recommended_action action)" "${ADVISOR_STATE}" "$(kv_or "${ADVISOR_SUMMARY}" recommendations observe)"
        printf 'Next actions\n------------\n%s\n\n' "${NEXT_ACTIONS:-none}"
        printf 'Events\n------\n'
        sed -n '1,200p' "${EVENTS_TMP}" 2> /dev/null || true
    }
}

build_json_content() {
    local summary_file tmp_json
    tmp_json="$(mktemp /tmp/network-control-plane-json.XXXXXX 2> /dev/null || true)"
    if [[ -z "${tmp_json}" ]]; then
        printf '{"status":"%s","json_status":"failed"}\n' "$(level_status "${OVERALL_LEVEL}")"
        return 0
    fi
    build_summary_content > "${tmp_json}.summary" 2> /dev/null || true
    if has_cmd python3; then
        python3 - "${tmp_json}.summary" "${EVENTS_TMP}" << 'PY' 2> /dev/null
import json, sys
summary = {}
try:
    with open(sys.argv[1], 'r', encoding='utf-8', errors='replace') as handle:
        for line in handle:
            line = line.rstrip('\n')
            if '=' in line:
                k, v = line.split('=', 1)
                summary[k] = v
except Exception:
    pass

events = []
try:
    with open(sys.argv[2], 'r', encoding='utf-8', errors='replace') as handle:
        for line in handle:
            parts = line.rstrip('\n').split('\t', 4)
            if len(parts) == 5:
                events.append({"timestamp": parts[0], "severity": parts[1], "component": parts[2], "code": parts[3], "message": parts[4]})
except Exception:
    pass
print(json.dumps({"summary": summary, "events": events}, ensure_ascii=False, indent=2))
PY
        rm -f "${tmp_json}" "${tmp_json}.summary" 2> /dev/null || true
        return 0
    fi
    printf '{"summary":{"status":"%s"},"events":[]}\n' "$(level_status "${OVERALL_LEVEL}")"
    rm -f "${tmp_json}" "${tmp_json}.summary" 2> /dev/null || true
}

print_human_summary() {
    local overall
    overall="$(level_status "${OVERALL_LEVEL}")"
    printf '\nNetwork/Copilot Control Plane: %s\n' "${overall}"
    printf '  • health:              %s\n' "${HEALTH_STATE}"
    printf '  • post-create:         %s\n' "${POST_CREATE_STATE}"
    printf '  • sync-local-auth:     %s\n' "${SYNC_LOCAL_AUTH_STATE}"
    printf '  • post-start:          %s\n' "${POST_START_STATE}"
    printf '  • registry:            %s rows=%s bad=%s\n' "${REGISTRY_STATUS}" "${REGISTRY_ROWS}" "${REGISTRY_BAD_ROWS}"
    printf '  • DNS:                 %s drift=%s current_ns=%s probe=%s split=%s\n' "${DNS_STATE}" "${DNS_DRIFT}" "${CURRENT_RESOLV_FIRST_NS}" "$(kv_or "${LOCAL_DNS_SUMMARY}" local_probe_proven unknown)" "$(kv_or "${LOCAL_DNS_SUMMARY}" docker_embedded_split_status unknown)"
    printf '  • route-fix:           %s kind=%s authority=%s action=%s\n' "${ROUTE_STATE}" "${ROUTE_RUNTIME_KIND}" "${ROUTE_AUTHORITY_STATE}" "${ROUTE_ACTION_STATE}"
    printf '  • Copilot manager:     %s endpoints=%s/%s registry=%s\n' "${MANAGER_STATE}" "$(kv_or "${MANAGER_SUMMARY}" endpoints_ok 0)" "$(kv_or "${MANAGER_SUMMARY}" endpoints_total 0)" "$(kv_or "${MANAGER_SUMMARY}" endpoint_registry_status unknown)"
    printf '  • proxy/advisor:       %s / %s\n' "${PROXY_STATE}" "${ADVISOR_STATE}"
    printf '  • events:              ok=%s advisory=%s warning=%s degraded=%s failed=%s fatal=%s\n' "${OK_COUNT}" "${ADVISORY_COUNT}" "${WARNING_COUNT}" "${DEGRADED_COUNT}" "${FAILED_COUNT}" "${FATAL_COUNT}"
    printf '  • next actions:        %s\n' "${NEXT_ACTIONS:-none}"
    printf '  • summary:             %s\n' "${SUMMARY_OUT}"
    printf '  • report:              %s\n' "${REPORT_OUT}"
    printf '\n'
}

write_outputs() {
    local status summary report json events_with_header
    status="$(level_status "${OVERALL_LEVEL}")"
    summary="$(build_summary_content)"
    report="$(build_report_content)"
    json="$(build_json_content)"
    events_with_header="$(
        printf 'timestamp	severity	component	code	message
'
        cat "${EVENTS_TMP}" 2> /dev/null || true
    )"
    write_atomic_file "${STATUS_OUT}" "${status}" 0644 || true
    write_atomic_file "${SUMMARY_OUT}" "${summary}" 0644 || true
    write_atomic_file "${REPORT_OUT}" "${report}" 0644 || true
    write_atomic_file "${EVENTS_OUT}" "${events_with_header}" 0644 || true
    write_atomic_file "${JSON_OUT}" "${json}" 0644 || true
}

run_analysis() {
    read_current_resolv_state
    read_hosts_state
    inspect_registry
    inspect_artifacts
    inspect_core
    inspect_dns
    inspect_manager
    inspect_route
    inspect_proxy
    inspect_advisor
    if [[ "${ACTION}" == "doctor" ]]; then
        if [[ "${REGISTRY_STATUS}" == "ok" ]]; then add_event ok doctor registry-contract "registry contract ok"; fi
        if [[ -r "${SUMMARY_OUT}" || "${NO_WRITE}" == "true" ]]; then add_event info doctor output-contract "output summary path=${SUMMARY_OUT}"; fi
    fi
}

main_unlocked() {
    run_analysis
    write_outputs
    case "${ACTION}" in
        status)
            printf '%s\n' "$(level_status "${OVERALL_LEVEL}")"
            ;;
        report)
            if [[ -r "${REPORT_OUT}" && "${NO_WRITE}" != "true" ]]; then cat "${REPORT_OUT}" 2> /dev/null || true; else build_report_content; fi
            ;;
        events)
            printf 'timestamp\tseverity\tcomponent\tcode\tmessage\n'
            cat "${EVENTS_TMP}" 2> /dev/null || true
            ;;
        json)
            if [[ -r "${JSON_OUT}" && "${NO_WRITE}" != "true" ]]; then cat "${JSON_OUT}" 2> /dev/null || true; else build_json_content; fi
            ;;
        summary | doctor | *)
            if [[ "${QUIET}" != "true" ]]; then
                case "${FORMAT}" in
                    json) build_json_content ;;
                    human | *) print_human_summary ;;
                esac
            fi
            ;;
    esac
}

main() {
    local rc status lock_dir
    if [[ "${NO_WRITE}" == "true" ]]; then
        main_unlocked
        rc=0
    else
        lock_dir="$(dirname "${LOCK_FILE}" 2> /dev/null || printf '/tmp')"
        mkdir -p "${lock_dir}" 2> /dev/null || true
        if has_cmd flock; then
            {
                if [[ "${LOCK_WAIT_SECONDS}" =~ ^[0-9]+$ && "${LOCK_WAIT_SECONDS}" -gt 0 ]]; then
                    flock -x -w "${LOCK_WAIT_SECONDS}" 9 || return 98
                else
                    flock -x 9 || return 98
                fi
                main_unlocked
            } 9> "${LOCK_FILE}"
            rc=$?
            if [[ "${rc}" -eq 98 ]]; then
                add_event advisory self lock-timeout "lock timeout on ${LOCK_FILE}; running without lock"
                main_unlocked
                rc=0
            fi
        else
            main_unlocked
            rc=0
        fi
    fi
    status="$(level_status "${OVERALL_LEVEL}")"
    rm -f "${EVENTS_TMP}" 2> /dev/null || true
    if [[ "${STRICT_MODE}" == "true" ]]; then
        case "${status}" in
            degraded | failed | fatal) return 1 ;;
        esac
    fi
    return "${rc:-0}"
}

main "$@"
exit $?
